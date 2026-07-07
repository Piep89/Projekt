// M6 – Aufgaben (NOT-01, PRO-06): Projektaufgaben, persönliche Aufgaben,
// projektübergreifende Übersicht „Mein Tag" und Synchronisation mit Protokollpunkten
const express = require('express');
const { get, all, run, tx } = require('../db');
const { now, today, ApiError } = require('../util');
const { audit, diff } = require('../audit');
const { requireAuth, projectAccess } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const QUELLEN = ['frei', 'protokoll', 'checkpunkt'];
const STATUS = ['offen', 'erledigt'];
const istDatum = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));

// SQL-Baustein: Aufgabe inkl. Projektname, Verantwortlichen-Name und Quelle-Label
const TASK_SELECT = `
  SELECT t.*, p.name AS projekt_name,
         COALESCE(u.display_name, c.name) AS verantwortlich_name,
         CASE t.quelle
           WHEN 'protokoll'  THEN (SELECT code FROM protocol_items WHERE id = t.quelle_id)
           WHEN 'checkpunkt' THEN (SELECT nr   FROM checkpoints    WHERE id = t.quelle_id)
           ELSE NULL END AS quelle_label
  FROM tasks t
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN users    u ON u.id = t.verantwortlich_user_id
  LEFT JOIN contacts c ON c.id = t.verantwortlich_kontakt_id`;

// Sichtbarkeit/Schreibrecht: mit project_id über Projektmitgliedschaft,
// ohne project_id ausschließlich Ersteller bzw. Verantwortlicher.
function taskAccess(req, task, mode = 'read') {
  if (task.project_id) {
    const access = projectAccess(req.user, task.project_id);
    if (!access) throw new ApiError(404, 'Aufgabe nicht gefunden');
    if (mode === 'write') {
      if (access.memberRole === 'leser') throw new ApiError(403, 'Keine Schreibrechte in diesem Projekt');
      if (access.project.status === 'archiviert') throw new ApiError(403, 'Projekt ist archiviert (schreibgeschützt)');
    }
    return access;
  }
  if (task.created_by !== req.user.id && task.verantwortlich_user_id !== req.user.id) {
    throw new ApiError(404, 'Aufgabe nicht gefunden');
  }
  return null;
}

function loadTask(id) {
  const t = get('SELECT * FROM tasks WHERE id = ?', Number(id));
  if (!t) throw new ApiError(404, 'Aufgabe nicht gefunden');
  return t;
}

// ---------------- Projektaufgaben (Liste) ----------------
router.get('/tasks', (req, res, next) => {
  try {
    const projektId = Number(req.query.projekt);
    if (!Number.isInteger(projektId) || projektId <= 0) throw new ApiError(400, 'Parameter projekt (Projekt-ID) ist Pflicht');
    if (!projectAccess(req.user, projektId)) throw new ApiError(404, 'Projekt nicht gefunden');

    const where = ['t.project_id = ?'];
    const params = [projektId];
    if (req.query.status) {
      if (!STATUS.includes(req.query.status)) throw new ApiError(400, 'Ungültiger Status');
      where.push('t.status = ?'); params.push(req.query.status);
    }
    if (req.query.quelle) {
      if (!QUELLEN.includes(req.query.quelle)) throw new ApiError(400, 'Ungültige Quelle');
      where.push('t.quelle = ?'); params.push(req.query.quelle);
    }
    res.json(all(`${TASK_SELECT} WHERE ${where.join(' AND ')}
      ORDER BY t.status = 'erledigt', t.termin IS NULL, t.termin, t.id DESC`, ...params));
  } catch (e) { next(e); }
});

// ---------------- „Mein Tag" – projektübergreifende Übersicht (NOT-01) ----------------
router.get('/my/overview', (req, res, next) => {
  try {
    const uid = req.user.id;
    const t = today();
    // Ende der laufenden Kalenderwoche (Sonntag)
    const d = new Date(t + 'T00:00:00Z');
    const dow = d.getUTCDay(); // 0 = So
    const wochenende = new Date(d.getTime() + (dow === 0 ? 0 : 7 - dow) * 86400e3).toISOString().slice(0, 10);

    // „Meine" Aufgaben: verantwortlich, erstellt oder über verknüpften Kontakt zugewiesen
    const meineWhere = `(t.verantwortlich_user_id = ? OR t.created_by = ?
      OR t.verantwortlich_kontakt_id IN (SELECT id FROM contacts WHERE user_id = ?))`;
    const offene = all(`${TASK_SELECT} WHERE ${meineWhere} AND t.status = 'offen'
      ORDER BY t.termin IS NULL, t.termin, t.id`, uid, uid, uid);

    const ueberfaellig = [], heute = [], dieseWoche = [], spaeter = [];
    for (const a of offene) {
      if (a.termin && a.termin < t) ueberfaellig.push(a);
      else if (a.termin === t) heute.push(a);
      else if (a.termin && a.termin <= wochenende) dieseWoche.push(a);
      else spaeter.push(a);
    }

    const erinnerungen = all(`${TASK_SELECT} WHERE ${meineWhere} AND t.status = 'offen'
      AND t.erinnerung IS NOT NULL AND t.erinnerung <= ? ORDER BY t.erinnerung, t.id`, uid, uid, uid, t);

    const erledigt = all(`${TASK_SELECT} WHERE ${meineWhere} AND t.status = 'erledigt'
      ORDER BY t.erledigt_am DESC, t.id DESC LIMIT 50`, uid, uid, uid);

    // Überfällige relevante Checkpunkte meiner (nicht archivierten) Projekte
    const ueberfaelligePunkte = all(
      `SELECT c.project_id AS projekt_id, p.name AS projekt_name, c.id, c.nr, c.text, c.termin
       FROM checkpoints c
       JOIN projects p ON p.id = c.project_id
       JOIN project_members m ON m.project_id = c.project_id AND m.user_id = ?
       WHERE p.status != 'archiviert' AND c.relevanz != 'nicht_relevant'
         AND c.status != 'erledigt' AND c.termin IS NOT NULL AND c.termin < ?
       ORDER BY c.termin, c.nr`, uid, t);

    // Offene Protokollpunkte mit überschrittenem Termin aus meinen Projekten
    const offeneProtokollpunkte = all(
      `SELECT pi.id, pi.code, pi.text, pi.termin, pi.meeting_id,
              pi.project_id AS projekt_id, p.name AS projekt_name
       FROM protocol_items pi
       JOIN projects p ON p.id = pi.project_id
       JOIN project_members m ON m.project_id = pi.project_id AND m.user_id = ?
       WHERE p.status != 'archiviert' AND pi.status = 'offen'
         AND pi.termin IS NOT NULL AND pi.termin < ?
       ORDER BY pi.termin, pi.code`, uid, t);

    // Überfällige benötigte Dokumente meiner Projekte (DOK-05 Erinnerung)
    const ueberfaelligeDokumente = all(
      `SELECT d.id, d.nr, d.titel, d.gewerk, d.faelligkeit,
              d.project_id AS projekt_id, p.name AS projekt_name
       FROM document_entries d
       JOIN projects p ON p.id = d.project_id
       JOIN project_members m ON m.project_id = d.project_id AND m.user_id = ?
       WHERE p.status != 'archiviert' AND d.benoetigt = 'ja' AND d.erhalten_am IS NULL
         AND d.faelligkeit IS NOT NULL AND d.faelligkeit < ?
       ORDER BY d.faelligkeit, d.bereich, d.nr`, uid, t);

    res.json({
      ueberfaellig,
      heute,
      diese_woche: dieseWoche,
      spaeter_oder_ohne_termin: spaeter,
      erinnerungen,
      erledigt,
      ueberfaellige_punkte: ueberfaelligePunkte,
      offene_protokollpunkte: offeneProtokollpunkte,
      ueberfaellige_dokumente: ueberfaelligeDokumente,
    });
  } catch (e) { next(e); }
});

// ---------------- Einzelne Aufgabe (Deep-Link/Detail) ----------------
router.get('/tasks/:id', (req, res, next) => {
  try {
    const task = loadTask(req.params.id);
    taskAccess(req, task, 'read');
    res.json(get(`${TASK_SELECT} WHERE t.id = ?`, task.id));
  } catch (e) { next(e); }
});

// ---------------- Aufgabe anlegen ----------------
router.post('/tasks', (req, res, next) => {
  try {
    const b = req.body || {};
    const titel = String(b.titel || '').trim();
    if (!titel) throw new ApiError(400, 'Titel ist Pflicht');
    const quelle = b.quelle || 'frei';
    if (!QUELLEN.includes(quelle)) throw new ApiError(400, 'Ungültige Quelle');

    const projectId = b.project_id ? Number(b.project_id) : null;
    if (b.project_id && (!Number.isInteger(projectId) || projectId <= 0)) throw new ApiError(400, 'Ungültige Projekt-ID');
    if (projectId) {
      const access = projectAccess(req.user, projectId);
      if (!access) throw new ApiError(404, 'Projekt nicht gefunden');
      if (access.memberRole === 'leser') throw new ApiError(403, 'Keine Schreibrechte in diesem Projekt');
      if (access.project.status === 'archiviert') throw new ApiError(403, 'Projekt ist archiviert (schreibgeschützt)');
    }

    let quelleId = null;
    if (quelle !== 'frei') {
      if (!projectId) throw new ApiError(400, 'Aufgaben aus Protokoll/Checkpunkt benötigen ein Projekt');
      quelleId = Number(b.quelle_id);
      if (!Number.isInteger(quelleId) || quelleId <= 0) throw new ApiError(400, 'quelle_id ist Pflicht bei dieser Quelle');
      const src = quelle === 'protokoll'
        ? get('SELECT project_id FROM protocol_items WHERE id = ?', quelleId)
        : get('SELECT project_id FROM checkpoints WHERE id = ?', quelleId);
      if (!src || src.project_id !== projectId) throw new ApiError(400, 'Quelle gehört nicht zu diesem Projekt');
    }

    let userId = b.verantwortlich_user_id ? Number(b.verantwortlich_user_id) : null;
    let kontaktId = b.verantwortlich_kontakt_id ? Number(b.verantwortlich_kontakt_id) : null;
    if (kontaktId) {
      if (!projectId) throw new ApiError(400, 'Kontakt-Verantwortliche sind nur bei Projektaufgaben möglich');
      const k = get('SELECT id FROM contacts WHERE id = ? AND project_id = ?', kontaktId, projectId);
      if (!k) throw new ApiError(400, 'Kontakt gehört nicht zu diesem Projekt');
    }
    if (userId && !get('SELECT id FROM users WHERE id = ? AND active = 1', userId)) throw new ApiError(400, 'Nutzer nicht gefunden');
    if (!userId && !kontaktId) userId = req.user.id;

    const termin = b.termin || null;
    const erinnerung = b.erinnerung || null;
    if (termin && !istDatum(termin)) throw new ApiError(400, 'Termin muss im Format JJJJ-MM-TT sein');
    if (erinnerung && !istDatum(erinnerung)) throw new ApiError(400, 'Erinnerung muss im Format JJJJ-MM-TT sein');

    const r = run(
      `INSERT INTO tasks (project_id, titel, beschreibung, quelle, quelle_id,
         verantwortlich_user_id, verantwortlich_kontakt_id, termin, erinnerung, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'offen', ?, ?)`,
      projectId, titel, b.beschreibung ? String(b.beschreibung) : null, quelle, quelleId,
      userId, kontaktId, termin, erinnerung, req.user.id, now());
    const id = Number(r.lastInsertRowid);
    if (projectId) audit(req, projectId, 'task', id, 'erstellt', { titel, quelle });
    res.status(201).json({ id });
  } catch (e) { next(e); }
});

// ---------------- Aufgabe ändern (inkl. Sync Aufgabe → Protokollpunkt, PRO-06) ----------------
router.patch('/tasks/:id', (req, res, next) => {
  try {
    const task = loadTask(req.params.id);
    taskAccess(req, task, 'write');
    const b = req.body || {};

    if (b.titel !== undefined && !String(b.titel).trim()) throw new ApiError(400, 'Titel darf nicht leer sein');
    if (b.status !== undefined && !STATUS.includes(b.status)) throw new ApiError(400, 'Ungültiger Status');
    if (b.termin !== undefined && b.termin !== null && b.termin !== '' && !istDatum(b.termin)) throw new ApiError(400, 'Termin muss im Format JJJJ-MM-TT sein');
    if (b.erinnerung !== undefined && b.erinnerung !== null && b.erinnerung !== '' && !istDatum(b.erinnerung)) throw new ApiError(400, 'Erinnerung muss im Format JJJJ-MM-TT sein');

    let kontaktId = b.verantwortlich_kontakt_id === undefined ? task.verantwortlich_kontakt_id
      : (b.verantwortlich_kontakt_id ? Number(b.verantwortlich_kontakt_id) : null);
    if (kontaktId && kontaktId !== task.verantwortlich_kontakt_id) {
      if (!task.project_id) throw new ApiError(400, 'Kontakt-Verantwortliche sind nur bei Projektaufgaben möglich');
      if (!get('SELECT id FROM contacts WHERE id = ? AND project_id = ?', kontaktId, task.project_id)) {
        throw new ApiError(400, 'Kontakt gehört nicht zu diesem Projekt');
      }
    }
    let userId = b.verantwortlich_user_id === undefined ? task.verantwortlich_user_id
      : (b.verantwortlich_user_id ? Number(b.verantwortlich_user_id) : null);
    if (userId && userId !== task.verantwortlich_user_id && !get('SELECT id FROM users WHERE id = ? AND active = 1', userId)) {
      throw new ApiError(400, 'Nutzer nicht gefunden');
    }

    const neu = {
      titel: b.titel !== undefined ? String(b.titel).trim() : task.titel,
      beschreibung: b.beschreibung !== undefined ? (b.beschreibung ? String(b.beschreibung) : null) : task.beschreibung,
      termin: b.termin !== undefined ? (b.termin || null) : task.termin,
      erinnerung: b.erinnerung !== undefined ? (b.erinnerung || null) : task.erinnerung,
      status: b.status !== undefined ? b.status : task.status,
      verantwortlich_user_id: userId,
      verantwortlich_kontakt_id: kontaktId,
    };
    const statusWechsel = neu.status !== task.status;
    const erledigtAm = neu.status === 'erledigt' ? (statusWechsel ? now() : task.erledigt_am) : null;

    tx(() => {
      run(`UPDATE tasks SET titel=?, beschreibung=?, termin=?, erinnerung=?, status=?,
             verantwortlich_user_id=?, verantwortlich_kontakt_id=?, erledigt_am=? WHERE id=?`,
        neu.titel, neu.beschreibung, neu.termin, neu.erinnerung, neu.status,
        neu.verantwortlich_user_id, neu.verantwortlich_kontakt_id, erledigtAm, task.id);

      // Sync Aufgabe → Protokollpunkt (PRO-06): nur bei tatsächlicher Abweichung schreiben
      if (task.quelle === 'protokoll' && task.quelle_id && statusWechsel) {
        const punkt = get('SELECT * FROM protocol_items WHERE id = ?', task.quelle_id);
        if (punkt && punkt.status !== neu.status) {
          run('UPDATE protocol_items SET status = ?, erledigt_am = ? WHERE id = ?',
            neu.status, neu.status === 'erledigt' ? now() : null, punkt.id);
          audit(req, punkt.project_id, 'protocol_item', punkt.id, 'status',
            { status: { von: punkt.status, nach: neu.status }, sync: `Aufgabe #${task.id}` });
        }
      }
    });

    if (task.project_id) {
      const details = diff(task, neu, ['titel', 'beschreibung', 'termin', 'erinnerung', 'verantwortlich_user_id', 'verantwortlich_kontakt_id']);
      if (statusWechsel) details.status = { von: task.status, nach: neu.status };
      audit(req, task.project_id, 'task', task.id, statusWechsel ? 'status' : 'geaendert', details);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- Aufgabe löschen ----------------
router.delete('/tasks/:id', (req, res, next) => {
  try {
    const task = loadTask(req.params.id);
    const access = taskAccess(req, task, 'write');
    if (task.quelle === 'protokoll') {
      throw new ApiError(400, 'Aufgaben aus Protokollpunkten werden über den Protokollpunkt verwaltet');
    }
    const istLeiter = access && access.memberRole === 'projektleiter';
    if (task.created_by !== req.user.id && !istLeiter) {
      throw new ApiError(403, 'Nur Ersteller oder Projektleiter dürfen Aufgaben löschen');
    }
    if (task.project_id) {
      require('../papierkorb').inPapierkorb(req, task.project_id, 'tasks', `Aufgabe: ${task.titel}`, { zeile: task });
    }
    run('DELETE FROM tasks WHERE id = ?', task.id);
    if (task.project_id) audit(req, task.project_id, 'task', task.id, 'geloescht', { titel: task.titel });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
