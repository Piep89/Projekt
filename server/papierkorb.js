// Papierkorb (UX-04): destruktive Aktionen sind 30 Tage wiederherstellbar.
const { get, all, run, tx } = require('./db');
const { now, ApiError } = require('./util');
const { audit } = require('./audit');

const AUFBEWAHRUNG_TAGE = 30;

/** Objekt vor dem Löschen sichern. `objekt` = {zeile, ...abhängige Daten}. */
function inPapierkorb(req, projectId, tabelle, bezeichnung, objekt) {
  run(`INSERT INTO papierkorb (project_id, tabelle, bezeichnung, objekt, geloescht_von, geloescht_am)
       VALUES (?, ?, ?, ?, ?, ?)`,
    projectId ?? null, tabelle, String(bezeichnung).slice(0, 200), JSON.stringify(objekt),
    req.user ? req.user.id : null, now());
}

/** Abgelaufene Einträge entsorgen (beim Serverstart). */
function aufraeumen() {
  run(`DELETE FROM papierkorb WHERE geloescht_am < datetime('now', ?)`, `-${AUFBEWAHRUNG_TAGE} days`);
}

// Einfügen mit Original-Spalten; bei ID-Konflikt ohne ID (neue vergeben)
function einfuegen(tabelle, zeile, ohneId = false) {
  const daten = { ...zeile };
  if (ohneId) delete daten.id;
  const spalten = Object.keys(daten);
  const r = run(
    `INSERT INTO ${tabelle} (${spalten.join(', ')}) VALUES (${spalten.map(() => '?').join(', ')})`,
    ...spalten.map((s) => daten[s]));
  return ohneId ? Number(r.lastInsertRowid) : zeile.id;
}

function einfuegenRobust(tabelle, zeile) {
  try { return einfuegen(tabelle, zeile, false); }
  catch { return einfuegen(tabelle, zeile, true); }
}

// Verweise bereinigen, deren Ziel inzwischen fehlt (Fremdschlüssel)
function pruefeRef(tabelle, id) {
  return id && get(`SELECT id FROM ${tabelle} WHERE id = ?`, id) ? id : null;
}

/** Wiederherstellung je Objektart. Gibt {typ, id} des wiederhergestellten Objekts zurück. */
function wiederherstellen(req, eintrag) {
  const objekt = JSON.parse(eintrag.objekt);
  const zeile = objekt.zeile;

  return tx(() => {
    switch (eintrag.tabelle) {
      case 'contacts': {
        const id = einfuegenRobust('contacts', { ...zeile, user_id: pruefeRef('users', zeile.user_id) });
        return { typ: 'contact', id };
      }
      case 'rooms': {
        const roomId = einfuegenRobust('rooms', zeile);
        for (const a of objekt.attribute || []) {
          einfuegen('room_attributes', { ...a, id: undefined, room_id: roomId }, true);
        }
        return { typ: 'room', id: roomId };
      }
      case 'checkpoints': {
        if (!get('SELECT id FROM phases WHERE id = ?', zeile.phase_id)) {
          throw new ApiError(409, 'Die Phase dieses Punkts existiert nicht mehr');
        }
        const id = einfuegenRobust('checkpoints', {
          ...zeile, verantwortlich_kontakt_id: pruefeRef('contacts', zeile.verantwortlich_kontakt_id),
        });
        return { typ: 'checkpoint', id };
      }
      case 'tasks': {
        const id = einfuegenRobust('tasks', {
          ...zeile,
          verantwortlich_kontakt_id: pruefeRef('contacts', zeile.verantwortlich_kontakt_id),
          verantwortlich_user_id: pruefeRef('users', zeile.verantwortlich_user_id),
          quelle_id: zeile.quelle === 'protokoll' ? pruefeRef('protocol_items', zeile.quelle_id) : zeile.quelle_id,
        });
        return { typ: 'task', id };
      }
      case 'protocol_items': {
        if (!get('SELECT id FROM meetings WHERE id = ?', zeile.meeting_id)) {
          throw new ApiError(409, 'Die Besprechung dieses Punkts existiert nicht mehr');
        }
        if (get('SELECT id FROM protocol_items WHERE project_id = ? AND typ_kuerzel = ? AND nummer = ?',
          zeile.project_id, zeile.typ_kuerzel, zeile.nummer)) {
          throw new ApiError(409, `Die Punktnummer ${zeile.code} ist inzwischen neu vergeben`);
        }
        const id = einfuegenRobust('protocol_items', {
          ...zeile,
          verantwortlich_kontakt_id: pruefeRef('contacts', zeile.verantwortlich_kontakt_id),
          task_id: null, nachtrag_zu: pruefeRef('protocol_items', zeile.nachtrag_zu),
        });
        if (objekt.task) {
          const taskId = einfuegenRobust('tasks', {
            ...objekt.task, quelle_id: id,
            verantwortlich_kontakt_id: pruefeRef('contacts', objekt.task.verantwortlich_kontakt_id),
            verantwortlich_user_id: pruefeRef('users', objekt.task.verantwortlich_user_id),
          });
          run('UPDATE protocol_items SET task_id = ? WHERE id = ?', taskId, id);
        }
        return { typ: 'protocol_item', id };
      }
      case 'milestones': {
        const id = einfuegenRobust('milestones', zeile);
        return { typ: 'milestone', id };
      }
      default:
        throw new ApiError(400, `Unbekannte Objektart '${eintrag.tabelle}'`);
    }
  });
}

module.exports = { inPapierkorb, wiederherstellen, aufraeumen, AUFBEWAHRUNG_TAGE };
