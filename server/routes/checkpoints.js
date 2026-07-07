// M2 – Checklisten-Abwicklung: Phasen, gefilterte Punktliste, Detail, Zusatzpunkte,
// CSV-Import, Massenbearbeitung und hartes Statusmodell (CHK-01…CHK-07, INT-01, Kap. 7)
const express = require('express');
const { get, all, run, tx } = require('../db');
const { now, today, ApiError, csvList, parseCsv } = require('../util');
const { audit, diff } = require('../audit');
const { requireAuth, requireProject, canWriteGewerk, projectAccess } = require('../auth');
const { resolveLabel } = require('./core');

const router = express.Router();
router.use(requireAuth);

const STATUS_WERTE = ['offen', 'in_bearbeitung', 'erledigt', 'blockiert'];
const PRIO_WERTE = ['hoch', 'normal', 'niedrig'];

// Projekt-ID eines Punktes für requireProject-Resolver ermitteln
function punktProjekt(req) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return 0;
  const c = get('SELECT project_id FROM checkpoints WHERE id = ?', id);
  return c ? c.project_id : 0;
}

// ---------------- Validierungs-Helfer ----------------
function pruefeTermin(wert) {
  if (wert === null || wert === undefined || wert === '') return null;
  const s = String(wert).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ApiError(400, 'Termin muss im Format JJJJ-MM-TT angegeben werden');
  return s;
}

function pruefeKontakt(projectId, wert) {
  if (wert === null || wert === undefined || wert === '') return null;
  const k = get('SELECT id FROM contacts WHERE id = ? AND project_id = ?', Number(wert), projectId);
  if (!k) throw new ApiError(400, 'Verantwortlicher Kontakt nicht gefunden');
  return k.id;
}

function pruefePrio(wert) {
  if (!PRIO_WERTE.includes(wert)) throw new ApiError(400, "Priorität muss 'hoch', 'normal' oder 'niedrig' sein");
  return wert;
}

function pruefeGewerke(wert) {
  const liste = csvList(wert);
  if (!liste.length) return '';
  const bekannt = new Set(all('SELECT kuerzel FROM gewerke').map((g) => g.kuerzel));
  for (const g of liste) {
    if (!bekannt.has(g)) throw new ApiError(400, `Unbekanntes Gewerk '${g}'`);
  }
  return liste.join(',');
}

// Nächste freie Zusatzpunkt-Laufnummer einer Phase (nr-Muster '<phase.nr>.Z01', CHK-06)
function maxZusatzNr(phaseId) {
  let max = 0;
  for (const r of all('SELECT nr FROM checkpoints WHERE phase_id = ? AND is_custom = 1', phaseId)) {
    const m = /\.Z(\d+)$/.exec(r.nr);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

// Blocker-Pflicht (CHK-01): Freitext ODER gültiger Verweis auf Checkpunkt/Aufgabe
function pruefeBlocker(cp, neu, body) {
  if (body.blocker_text !== undefined) neu.blocker_text = String(body.blocker_text || '').trim() || null;
  if (body.blocker_ref_typ !== undefined) neu.blocker_ref_typ = body.blocker_ref_typ || null;
  if (body.blocker_ref_id !== undefined) neu.blocker_ref_id = body.blocker_ref_id ? Number(body.blocker_ref_id) : null;
  if (neu.blocker_ref_typ || neu.blocker_ref_id) {
    if (!['checkpoint', 'task'].includes(neu.blocker_ref_typ)) {
      throw new ApiError(400, "Blocker-Verweis muss vom Typ 'checkpoint' oder 'task' sein");
    }
    if (!Number.isInteger(neu.blocker_ref_id) || neu.blocker_ref_id <= 0) {
      throw new ApiError(400, 'Blocker-Verweis: Ziel-ID fehlt');
    }
    if (neu.blocker_ref_typ === 'checkpoint') {
      if (neu.blocker_ref_id === cp.id) throw new ApiError(400, 'Ein Punkt kann nicht sich selbst blockieren');
      if (!get('SELECT id FROM checkpoints WHERE id = ? AND project_id = ?', neu.blocker_ref_id, cp.project_id)) {
        throw new ApiError(400, 'Blocker-Checkpunkt nicht gefunden');
      }
    } else {
      const t = get('SELECT id, project_id FROM tasks WHERE id = ?', neu.blocker_ref_id);
      if (!t || (t.project_id !== null && t.project_id !== cp.project_id)) {
        throw new ApiError(400, 'Blocker-Aufgabe nicht gefunden');
      }
    }
  }
  if (!neu.blocker_text && !neu.blocker_ref_id) {
    throw new ApiError(400, 'Bei „Blockiert“ ist ein Blocker-Text oder ein Verweis auf Punkt/Aufgabe Pflicht');
  }
}

// Detailansicht inkl. Phase, Verantwortlichen-Name und Blocker-Label
function punktDetail(id) {
  const c = get(
    `SELECT c.*, ph.nr AS phase_nr, ph.name AS phase_name, k.name AS verantwortlich_name
     FROM checkpoints c
     JOIN phases ph ON ph.id = c.phase_id
     LEFT JOIN contacts k ON k.id = c.verantwortlich_kontakt_id
     WHERE c.id = ?`, id);
  if (c && c.blocker_ref_typ && c.blocker_ref_id) {
    c.blocker_label = resolveLabel(c.blocker_ref_typ, c.blocker_ref_id);
  }
  return c;
}

/**
 * Kern von PATCH und Massenbearbeitung: wendet einen Patch hart validiert an
 * (CHK-01/02, Statusmodell Kap. 7). Wirft ApiError bei Regelverstößen.
 * @returns {boolean} true, wenn tatsächlich etwas geändert wurde
 */
function wendePatchAn(req, access, cp, body) {
  if (!canWriteGewerk(access, cp.gewerke)) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');

  const neu = { ...cp };
  let statusWechsel = null;
  let wiedereroeffnungsKommentar = null;

  // ---- Relevanz (CHK-01): 'nicht_relevant' nur aus Status 'offen', Begründung Pflicht, reversibel ----
  if (body.relevanz !== undefined) {
    if (!['relevant', 'nicht_relevant'].includes(body.relevanz)) {
      throw new ApiError(400, "Relevanz muss 'relevant' oder 'nicht_relevant' sein");
    }
    if (body.relevanz === 'nicht_relevant') {
      if (cp.relevanz === 'nicht_relevant') throw new ApiError(400, 'Punkt ist bereits als „Nicht relevant“ markiert');
      if (cp.status !== 'offen') throw new ApiError(400, '„Nicht relevant“ ist nur bei offenen Punkten möglich');
      if (body.status !== undefined && body.status !== cp.status) {
        throw new ApiError(400, 'Statuswechsel und „Nicht relevant“ sind nicht gleichzeitig möglich');
      }
      const begruendung = String(body.relevanz_begruendung || '').trim();
      if (!begruendung) throw new ApiError(400, 'Begründung ist bei "Nicht relevant" Pflicht');
      neu.relevanz = 'nicht_relevant';
      neu.relevanz_begruendung = begruendung;
    } else {
      neu.relevanz = 'relevant';
      if (cp.relevanz === 'nicht_relevant') neu.relevanz_begruendung = null; // reversibel
    }
  }

  // Nicht relevante Punkte sind gesperrt, bis die Relevanz zurückgesetzt wird
  if (cp.relevanz === 'nicht_relevant' && neu.relevanz === 'nicht_relevant') {
    throw new ApiError(400, 'Punkt ist als „Nicht relevant“ markiert – erst die Relevanz zurücksetzen');
  }

  // ---- Status (Kap. 7): Offen → In Bearbeitung → Erledigt; Seitenstatus Blockiert ----
  if (body.status !== undefined && body.status !== cp.status) {
    if (!STATUS_WERTE.includes(body.status)) throw new ApiError(400, 'Ungültiger Status');
    const von = cp.status;
    const nach = body.status;
    if (nach === 'blockiert') {
      if (!['offen', 'in_bearbeitung'].includes(von)) {
        throw new ApiError(400, '„Blockiert“ ist nur aus „Offen“ oder „In Bearbeitung“ möglich');
      }
      pruefeBlocker(cp, neu, body);
    }
    if (von === 'erledigt') {
      // Wiedereröffnung nur mit Pflichtkommentar (CHK-02)
      if (!['offen', 'in_bearbeitung'].includes(nach)) {
        throw new ApiError(400, 'Erledigte Punkte können nur nach „Offen“ oder „In Bearbeitung“ wiedereröffnet werden');
      }
      wiedereroeffnungsKommentar = String(body.kommentar || '').trim();
      if (!wiedereroeffnungsKommentar) throw new ApiError(400, 'Wiedereröffnen eines erledigten Punktes erfordert einen Kommentar');
      neu.erledigt_am = null;
    }
    if (nach === 'erledigt') neu.erledigt_am = now();
    if (von === 'blockiert') { neu.blocker_text = null; neu.blocker_ref_typ = null; neu.blocker_ref_id = null; }
    neu.status = nach;
    statusWechsel = { von, nach };
  } else if (cp.status === 'blockiert'
    && (body.blocker_text !== undefined || body.blocker_ref_typ !== undefined || body.blocker_ref_id !== undefined)) {
    // Blocker-Angaben eines blockierten Punktes aktualisieren
    pruefeBlocker(cp, neu, body);
  }

  // ---- Einfache Felder ----
  if (body.verantwortlich_kontakt_id !== undefined) neu.verantwortlich_kontakt_id = pruefeKontakt(cp.project_id, body.verantwortlich_kontakt_id);
  if (body.termin !== undefined) neu.termin = pruefeTermin(body.termin);
  if (body.prio !== undefined) neu.prio = pruefePrio(body.prio);

  // ---- Stammfelder nur bei Zusatzpunkten änderbar (CHK-06) ----
  for (const feldName of ['text', 'gewerke', 'fuehrend', 'hinweis']) {
    if (body[feldName] === undefined) continue;
    if (String(body[feldName] ?? '') === String(cp[feldName] ?? '')) continue;
    if (!cp.is_custom) throw new ApiError(400, 'Text, Gewerke, führendes Gewerk und Hinweis sind nur bei Zusatzpunkten änderbar');
    if (feldName === 'text') {
      const t = String(body.text || '').trim();
      if (!t) throw new ApiError(400, 'Text darf nicht leer sein');
      neu.text = t;
    } else if (feldName === 'gewerke') {
      neu.gewerke = pruefeGewerke(body.gewerke);
      if (!canWriteGewerk(access, neu.gewerke)) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');
    } else if (feldName === 'fuehrend') {
      neu.fuehrend = body.fuehrend ? pruefeGewerke(body.fuehrend) : null;
    } else {
      neu.hinweis = body.hinweis ? String(body.hinweis).trim() : null;
    }
  }

  const felder = ['relevanz', 'relevanz_begruendung', 'verantwortlich_kontakt_id', 'termin', 'prio',
    'text', 'gewerke', 'fuehrend', 'hinweis', 'blocker_text', 'blocker_ref_typ', 'blocker_ref_id'];
  const aenderungen = diff(cp, neu, felder);
  if (!statusWechsel && !Object.keys(aenderungen).length) return false; // nichts zu tun

  tx(() => {
    run(
      `UPDATE checkpoints SET text = ?, gewerke = ?, fuehrend = ?, hinweis = ?, relevanz = ?, relevanz_begruendung = ?,
         status = ?, blocker_text = ?, blocker_ref_typ = ?, blocker_ref_id = ?, verantwortlich_kontakt_id = ?,
         termin = ?, prio = ?, erledigt_am = ?, updated_at = ? WHERE id = ?`,
      neu.text, neu.gewerke, neu.fuehrend, neu.hinweis, neu.relevanz, neu.relevanz_begruendung,
      neu.status, neu.blocker_text, neu.blocker_ref_typ, neu.blocker_ref_id, neu.verantwortlich_kontakt_id,
      neu.termin, neu.prio, neu.erledigt_am, now(), cp.id);
    if (wiedereroeffnungsKommentar) {
      run('INSERT INTO comments (object_typ, object_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
        'checkpoint', cp.id, req.user.id, wiedereroeffnungsKommentar, now());
      audit(req, cp.project_id, 'checkpoint', cp.id, 'kommentar',
        { text: wiedereroeffnungsKommentar.slice(0, 200), anlass: 'wiedereroeffnung' });
    }
    if (statusWechsel) audit(req, cp.project_id, 'checkpoint', cp.id, 'status', { status: statusWechsel });
    if (Object.keys(aenderungen).length) audit(req, cp.project_id, 'checkpoint', cp.id, 'geaendert', aenderungen);
  });
  return true;
}

// ---------------- Phasen des Projekts (mit Fortschritt) ----------------
router.get('/projects/:projectId/phases', requireProject('read'), (req, res) => {
  res.json(all(
    `SELECT ph.id, ph.nr, ph.name, ph.sort_order,
       COUNT(c.id) AS gesamt,
       SUM(CASE WHEN c.relevanz != 'nicht_relevant' THEN 1 ELSE 0 END) AS relevant,
       SUM(CASE WHEN c.relevanz != 'nicht_relevant' AND c.status = 'erledigt' THEN 1 ELSE 0 END) AS erledigt,
       SUM(CASE WHEN c.relevanz = 'unbewertet' THEN 1 ELSE 0 END) AS unbewertet
     FROM phases ph LEFT JOIN checkpoints c ON c.phase_id = ph.id
     WHERE ph.project_id = ?
     GROUP BY ph.id ORDER BY ph.sort_order, ph.nr`, req.project.id));
});

// ---------------- Punktliste mit kombinierbaren Filtern (CHK-03) ----------------
router.get('/projects/:projectId/checkpoints', requireProject('read'), (req, res, next) => {
  try {
    const { phase_id, gewerk, status, relevanz, verantwortlich, termin, q } = req.query;
    const bedingungen = ['c.project_id = ?'];
    const parameter = [req.project.id];
    if (phase_id) { bedingungen.push('c.phase_id = ?'); parameter.push(Number(phase_id)); }
    if (gewerk) {
      // Muster auf ','||gewerke||',' verhindert Teiltreffer (z. B. 'ELT' in 'MELT')
      bedingungen.push("(',' || c.gewerke || ',') LIKE ?");
      parameter.push(`%,${String(gewerk).trim()},%`);
    }
    if (status) { bedingungen.push('c.status = ?'); parameter.push(String(status)); }
    if (relevanz) { bedingungen.push('c.relevanz = ?'); parameter.push(String(relevanz)); }
    if (verantwortlich) { bedingungen.push('c.verantwortlich_kontakt_id = ?'); parameter.push(Number(verantwortlich)); }
    if (termin === 'ueberfaellig') {
      bedingungen.push("c.termin IS NOT NULL AND c.termin < ? AND c.status != 'erledigt' AND c.relevanz != 'nicht_relevant'");
      parameter.push(today());
    } else if (termin === 'woche') {
      bedingungen.push('c.termin IS NOT NULL AND c.termin <= ?');
      parameter.push(new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
    }
    if (q && String(q).trim()) {
      const muster = `%${String(q).trim()}%`;
      bedingungen.push("(c.nr LIKE ? OR c.text LIKE ? OR COALESCE(c.hinweis, '') LIKE ?)");
      parameter.push(muster, muster, muster);
    }
    res.json(all(
      `SELECT c.*, ph.nr AS phase_nr, ph.name AS phase_name, ph.sort_order AS phase_sort, k.name AS verantwortlich_name
       FROM checkpoints c
       JOIN phases ph ON ph.id = c.phase_id
       LEFT JOIN contacts k ON k.id = c.verantwortlich_kontakt_id
       WHERE ${bedingungen.join(' AND ')}
       ORDER BY ph.sort_order, ph.nr, c.nr`, ...parameter));
  } catch (e) { next(e); }
});

// ---------------- Zusatzpunkt anlegen (CHK-06) ----------------
router.post('/projects/:projectId/checkpoints', requireProject('write'), (req, res, next) => {
  try {
    const { phase_id, text, gewerke, fuehrend, prio, termin, verantwortlich_kontakt_id, hinweis } = req.body || {};
    const phase = get('SELECT * FROM phases WHERE id = ? AND project_id = ?', Number(phase_id || 0), req.project.id);
    if (!phase) throw new ApiError(400, 'Phase nicht gefunden');
    const punktText = String(text || '').trim();
    if (!punktText) throw new ApiError(400, 'Text ist Pflicht');
    const gewerkeCsv = pruefeGewerke(gewerke || '');
    if (!canWriteGewerk(req.access, gewerkeCsv)) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');
    const fuehrendWert = fuehrend ? pruefeGewerke(fuehrend) : null;
    const prioWert = (prio === undefined || prio === null || prio === '') ? 'normal' : pruefePrio(prio);
    const terminWert = pruefeTermin(termin);
    const kontaktId = pruefeKontakt(req.project.id, verantwortlich_kontakt_id);
    const nr = `${phase.nr}.Z${String(maxZusatzNr(phase.id) + 1).padStart(2, '0')}`;
    const r = run(
      `INSERT INTO checkpoints (project_id, phase_id, nr, text, gewerke, fuehrend, hinweis, relevanz,
         verantwortlich_kontakt_id, termin, prio, is_custom, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'relevant', ?, ?, ?, 1, ?, ?)`,
      req.project.id, phase.id, nr, punktText, gewerkeCsv, fuehrendWert,
      hinweis ? String(hinweis).trim() : null, kontaktId, terminWert, prioWert, now(), now());
    const id = Number(r.lastInsertRowid);
    audit(req, req.project.id, 'checkpoint', id, 'erstellt', { nr, text: punktText.slice(0, 120) });
    res.status(201).json({ id, nr });
  } catch (e) { next(e); }
});

// ---------------- CSV-Import von Zusatzpunkten (INT-01) ----------------
// Spalten: Phase;Text;Gewerke;Prio;Termin – commit=false liefert nur die Vorschau
router.post('/projects/:projectId/checkpoints/import', requireProject('write'), (req, res, next) => {
  try {
    const { csv, commit } = req.body || {};
    if (!csv || !String(csv).trim()) throw new ApiError(400, 'CSV-Inhalt fehlt');
    const zeilen = parseCsv(csv);
    const phasenNachNr = {};
    for (const ph of all('SELECT * FROM phases WHERE project_id = ?', req.project.id)) {
      phasenNachNr[String(ph.nr)] = ph;
    }
    const bekannteGewerke = new Set(all('SELECT kuerzel FROM gewerke').map((g) => g.kuerzel));
    const ok = [];
    const fehler = [];
    zeilen.forEach((felder, i) => {
      const zeile = i + 1;
      const [phaseRaw, textRaw, gewerkeRaw, prioRaw, terminRaw] =
        [0, 1, 2, 3, 4].map((n) => String(felder[n] ?? '').trim());
      if (zeile === 1 && phaseRaw.toLowerCase() === 'phase') return; // Kopfzeile überspringen
      try {
        const phase = phasenNachNr[phaseRaw.replace(/^phase\s*/i, '')];
        if (!phase) throw new Error(`Phase '${phaseRaw}' nicht gefunden`);
        if (!textRaw) throw new Error('Text fehlt');
        const gewerkeListe = csvList(gewerkeRaw);
        for (const g of gewerkeListe) {
          if (!bekannteGewerke.has(g)) throw new Error(`Unbekanntes Gewerk '${g}'`);
        }
        const gewerkeCsv = gewerkeListe.join(',');
        if (!canWriteGewerk(req.access, gewerkeCsv)) throw new Error('Keine Schreibrechte für dieses Gewerk');
        const prio = prioRaw ? prioRaw.toLowerCase() : 'normal';
        if (!PRIO_WERTE.includes(prio)) throw new Error(`Priorität '${prioRaw}' ist ungültig (hoch/normal/niedrig)`);
        let termin = null;
        if (terminRaw) {
          const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(terminRaw);
          if (de) termin = `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;
          else if (/^\d{4}-\d{2}-\d{2}$/.test(terminRaw)) termin = terminRaw;
          else throw new Error(`Termin '${terminRaw}' ist ungültig (JJJJ-MM-TT oder TT.MM.JJJJ)`);
        }
        ok.push({ zeile, phase_id: phase.id, phase_nr: phase.nr, phase_name: phase.name, text: textRaw, gewerke: gewerkeCsv, prio, termin });
      } catch (e) { fehler.push({ zeile, grund: e.message }); }
    });
    if (!ok.length && !fehler.length) throw new ApiError(400, 'Keine auswertbaren Zeilen gefunden');
    if (!commit) return res.json({ ok, fehler });

    const zaehler = {};
    const punkte = [];
    tx(() => {
      for (const p of ok) {
        if (zaehler[p.phase_id] === undefined) zaehler[p.phase_id] = maxZusatzNr(p.phase_id);
        zaehler[p.phase_id]++;
        const nr = `${p.phase_nr}.Z${String(zaehler[p.phase_id]).padStart(2, '0')}`;
        const r = run(
          `INSERT INTO checkpoints (project_id, phase_id, nr, text, gewerke, prio, termin, relevanz, is_custom, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'relevant', 1, ?, ?)`,
          req.project.id, p.phase_id, nr, p.text, p.gewerke, p.prio, p.termin, now(), now());
        const id = Number(r.lastInsertRowid);
        audit(req, req.project.id, 'checkpoint', id, 'erstellt', { nr, text: p.text.slice(0, 120), quelle: 'csv-import' });
        punkte.push({ id, nr, zeile: p.zeile });
      }
    });
    res.json({ angelegt: punkte.length, punkte, fehler });
  } catch (e) { next(e); }
});

// ---------------- Massenbearbeitung (CHK-07) ----------------
router.post('/checkpoints/bulk', (req, res, next) => {
  try {
    const { ids, patch } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'ids (Liste der Punkt-IDs) ist Pflicht');
    if (!patch || typeof patch !== 'object' || !Object.keys(patch).length) {
      throw new ApiError(400, 'patch mit mindestens einer Änderung ist Pflicht');
    }
    let ok = 0;
    const fehler = [];
    for (const roheId of ids) {
      const id = Number(roheId);
      try {
        const cp = Number.isInteger(id) && id > 0 ? get('SELECT * FROM checkpoints WHERE id = ?', id) : null;
        if (!cp) throw new ApiError(404, 'Punkt nicht gefunden');
        const access = projectAccess(req.user, cp.project_id);
        if (!access) throw new ApiError(404, 'Punkt nicht gefunden');
        if (access.memberRole === 'leser') throw new ApiError(403, 'Keine Schreibrechte in diesem Projekt');
        if (access.project.status === 'archiviert') throw new ApiError(403, 'Projekt ist archiviert (schreibgeschützt)');
        wendePatchAn(req, access, cp, patch);
        ok++;
      } catch (e) {
        if (e instanceof ApiError) fehler.push({ id, grund: e.message });
        else throw e;
      }
    }
    res.json({ ok, fehler });
  } catch (e) { next(e); }
});

// ---------------- Punkt-Detail ----------------
router.get('/checkpoints/:id', requireProject('read', punktProjekt), (req, res, next) => {
  try {
    const c = punktDetail(Number(req.params.id));
    if (!c) throw new ApiError(404, 'Punkt nicht gefunden');
    res.json(c);
  } catch (e) { next(e); }
});

// ---------------- Punkt ändern (Herzstück, CHK-01/02) ----------------
router.patch('/checkpoints/:id', requireProject('write', punktProjekt), (req, res, next) => {
  try {
    const cp = get('SELECT * FROM checkpoints WHERE id = ?', Number(req.params.id));
    if (!cp) throw new ApiError(404, 'Punkt nicht gefunden');
    wendePatchAn(req, req.access, cp, req.body || {});
    res.json(punktDetail(cp.id));
  } catch (e) { next(e); }
});

// ---------------- Zusatzpunkt löschen (nur is_custom, CHK-06) ----------------
router.delete('/checkpoints/:id', requireProject('write', punktProjekt), (req, res, next) => {
  try {
    const cp = get('SELECT * FROM checkpoints WHERE id = ?', Number(req.params.id));
    if (!cp) throw new ApiError(404, 'Punkt nicht gefunden');
    if (!cp.is_custom) throw new ApiError(400, 'Nur Zusatzpunkte können gelöscht werden');
    if (!canWriteGewerk(req.access, cp.gewerke)) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');
    require('../papierkorb').inPapierkorb(req, cp.project_id, 'checkpoints', `Zusatzpunkt ${cp.nr}: ${cp.text.slice(0, 80)}`, { zeile: cp });
    run('DELETE FROM checkpoints WHERE id = ?', cp.id);
    audit(req, cp.project_id, 'checkpoint', cp.id, 'geloescht', { nr: cp.nr, text: cp.text.slice(0, 120) });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
