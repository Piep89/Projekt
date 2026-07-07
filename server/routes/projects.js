// M1 – Projekt- und Vorlagenverwaltung: Anlage-Assistent, Dashboard, Portfolio,
// Meilensteine, Mitglieder, Kopie, Archivierung, Abnahmereife-Prüfung
const express = require('express');
const { get, all, run, tx } = require('../db');
const { now, today, ApiError, csvList } = require('../util');
const { audit } = require('../audit');
const { requireAuth, requireProject } = require('../auth');
const { instantiateProject } = require('../services/instantiate');

const router = express.Router();
router.use(requireAuth);

const GERAETETYPEN = ['MRT', 'CT', 'Angiographie', 'Hybrid-OP', 'PET-CT', 'Linearbeschleuniger', 'Sonstiges'];

// ---------------- Portfolio (PRJ-07) ----------------
router.get('/projects', (req, res) => {
  const rows = req.user.role === 'admin'
    ? all('SELECT * FROM projects ORDER BY status = \'archiviert\', name')
    : all(`SELECT p.* FROM projects p JOIN project_members m ON m.project_id = p.id
           WHERE m.user_id = ? ORDER BY p.status = 'archiviert', p.name`, req.user.id);
  const t = today();
  res.json(rows.map((p) => {
    const stats = get(
      `SELECT
         SUM(CASE WHEN relevanz != 'nicht_relevant' THEN 1 ELSE 0 END) AS relevant,
         SUM(CASE WHEN relevanz != 'nicht_relevant' AND status = 'erledigt' THEN 1 ELSE 0 END) AS erledigt,
         SUM(CASE WHEN relevanz != 'nicht_relevant' AND status != 'erledigt' AND termin IS NOT NULL AND termin < ? THEN 1 ELSE 0 END) AS ueberfaellig
       FROM checkpoints WHERE project_id = ?`, t, p.id);
    const nextMilestone = get(
      `SELECT name, datum FROM milestones WHERE project_id = ? AND erledigt = 0 AND datum >= ?
       ORDER BY datum LIMIT 1`, p.id, t);
    return {
      ...p,
      fortschritt: stats.relevant ? Math.round((stats.erledigt / stats.relevant) * 100) : 0,
      punkte_relevant: stats.relevant || 0,
      punkte_erledigt: stats.erledigt || 0,
      punkte_ueberfaellig: stats.ueberfaellig || 0,
      naechster_meilenstein: nextMilestone || null,
    };
  }));
});

// ---------------- Projekt anlegen (PRJ-01) ----------------
router.post('/projects', (req, res, next) => {
  try {
    const { name, geraetetyp, template_id, gebaeude, ebene, budget, beschreibung, meilensteine } = req.body || {};
    if (!name || !String(name).trim()) throw new ApiError(400, 'Projektname ist Pflicht');
    if (!GERAETETYPEN.includes(geraetetyp)) throw new ApiError(400, `Gerätetyp muss einer von: ${GERAETETYPEN.join(', ')} sein`);
    const template = template_id
      ? get('SELECT * FROM templates WHERE id = ?', Number(template_id))
      : get("SELECT * FROM templates WHERE status = 'aktiv' ORDER BY id DESC LIMIT 1");
    if (!template) throw new ApiError(400, 'Keine Vorlage gefunden – bitte zuerst eine Vorlage laden');

    const result = instantiateProject(template,
      { name, geraetetyp, gebaeude, ebene, budget, beschreibung, meilensteine }, req.user.id);

    req.params.projectId = String(result.projectId);
    audit(req, result.projectId, 'project', result.projectId, 'erstellt',
      { name, geraetetyp, vorlage: `${template.name} (v${template.version})`, punkte: result.punkte, dokumente: result.dokumente });
    res.status(201).json({ id: result.projectId, punkte: result.punkte, dokumente: result.dokumente });
  } catch (e) { next(e); }
});

router.get('/projects/meta', (req, res) => {
  res.json({
    geraetetypen: GERAETETYPEN,
    vorlagen: all("SELECT id, version, name, status FROM templates ORDER BY id DESC"),
  });
});

// ---------------- Dashboard (PRJ-02) ----------------
router.get('/projects/:projectId', requireProject('read'), (req, res) => {
  const p = req.project;
  const t = today();
  const phasen = all(
    `SELECT ph.id, ph.nr, ph.name,
       SUM(CASE WHEN c.relevanz != 'nicht_relevant' THEN 1 ELSE 0 END) AS relevant,
       SUM(CASE WHEN c.relevanz != 'nicht_relevant' AND c.status = 'erledigt' THEN 1 ELSE 0 END) AS erledigt,
       SUM(CASE WHEN c.relevanz = 'unbewertet' THEN 1 ELSE 0 END) AS unbewertet,
       COUNT(c.id) AS gesamt
     FROM phases ph LEFT JOIN checkpoints c ON c.phase_id = ph.id
     WHERE ph.project_id = ? GROUP BY ph.id ORDER BY ph.sort_order`, p.id);

  // Offene/überfällige Punkte je Gewerk (CSV-Spalte in JS zerlegen)
  const offenePunkte = all(
    `SELECT gewerke, termin, status FROM checkpoints
     WHERE project_id = ? AND relevanz != 'nicht_relevant' AND status != 'erledigt'`, p.id);
  const jeGewerk = {};
  for (const cp of offenePunkte) {
    const list = csvList(cp.gewerke);
    for (const g of (list.length ? list : ['—'])) {
      jeGewerk[g] = jeGewerk[g] || { offen: 0, ueberfaellig: 0, blockiert: 0 };
      jeGewerk[g].offen++;
      if (cp.termin && cp.termin < t) jeGewerk[g].ueberfaellig++;
      if (cp.status === 'blockiert') jeGewerk[g].blockiert++;
    }
  }

  const dokumente = get(
    `SELECT
       SUM(CASE WHEN benoetigt = 'ja' THEN 1 ELSE 0 END) AS benoetigt,
       SUM(CASE WHEN benoetigt = 'ja' AND erhalten_am IS NOT NULL THEN 1 ELSE 0 END) AS erhalten,
       SUM(CASE WHEN benoetigt = 'unbewertet' THEN 1 ELSE 0 END) AS unbewertet
     FROM document_entries WHERE project_id = ?`, p.id);

  const gesamt = phasen.reduce((a, x) => ({ relevant: a.relevant + (x.relevant || 0), erledigt: a.erledigt + (x.erledigt || 0), unbewertet: a.unbewertet + (x.unbewertet || 0) }),
    { relevant: 0, erledigt: 0, unbewertet: 0 });

  res.json({
    ...p,
    zugriff: { rolle: req.access.memberRole, gewerke: req.access.gewerke },
    fortschritt: gesamt.relevant ? Math.round((gesamt.erledigt / gesamt.relevant) * 100) : 0,
    punkte: gesamt,
    phasen,
    je_gewerk: jeGewerk,
    dokumente,
    meilensteine: all('SELECT * FROM milestones WHERE project_id = ? ORDER BY sort_order', p.id),
    naechste_besprechungen: all('SELECT id, titel, typ, datum, status FROM meetings WHERE project_id = ? AND datum >= ? ORDER BY datum LIMIT 5', p.id, t),
    naechste_termine: all(
      `SELECT id, nr, text, termin, gewerke FROM checkpoints
       WHERE project_id = ? AND relevanz != 'nicht_relevant' AND status != 'erledigt' AND termin IS NOT NULL
       ORDER BY termin LIMIT 8`, p.id),
    letzte_journaleintraege: all('SELECT id, datum, kategorie, substr(text,1,160) AS text FROM journal_entries WHERE project_id = ? ORDER BY datum DESC, id DESC LIMIT 5', p.id),
    offene_maengel: get("SELECT COUNT(*) AS n FROM defects WHERE project_id = ? AND status != 'abgenommen'", p.id).n,
    offene_aufgaben: get("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status = 'offen'", p.id).n,
  });
});

// ---------------- Stammdaten / Status (PRJ-04) ----------------
router.patch('/projects/:projectId', requireProject('read'), (req, res, next) => {
  try {
    const p = req.project;
    if (req.access.memberRole !== 'projektleiter') throw new ApiError(403, 'Nur Projektleiter dürfen Stammdaten ändern');
    const { name, geraetetyp, gebaeude, ebene, budget, beschreibung, status } = req.body || {};
    if (status && !['aktiv', 'pausiert', 'archiviert'].includes(status)) throw new ApiError(400, 'Ungültiger Status');
    if (p.status === 'archiviert' && !(status && status !== 'archiviert') ) {
      // Archivierte Projekte sind schreibgeschützt; nur Reaktivierung ist erlaubt
      if (status === undefined || status === 'archiviert') throw new ApiError(403, 'Projekt ist archiviert (schreibgeschützt)');
    }
    if (geraetetyp && !GERAETETYPEN.includes(geraetetyp)) throw new ApiError(400, 'Ungültiger Gerätetyp');
    const neu = {
      name: name ?? p.name, geraetetyp: geraetetyp ?? p.geraetetyp, gebaeude: gebaeude ?? p.gebaeude,
      ebene: ebene ?? p.ebene, budget: budget ?? p.budget, beschreibung: beschreibung ?? p.beschreibung,
      status: status ?? p.status,
    };
    run(`UPDATE projects SET name=?, geraetetyp=?, gebaeude=?, ebene=?, budget=?, beschreibung=?, status=?,
         archived_at = CASE WHEN ? = 'archiviert' THEN COALESCE(archived_at, ?) ELSE NULL END WHERE id=?`,
      neu.name, neu.geraetetyp, neu.gebaeude, neu.ebene, neu.budget, neu.beschreibung, neu.status,
      neu.status, now(), p.id);
    const details = {};
    for (const k of Object.keys(neu)) if (String(neu[k] ?? '') !== String(p[k] ?? '')) details[k] = { von: p[k], nach: neu[k] };
    audit(req, p.id, 'project', p.id, status && status !== p.status ? `status_${status}` : 'geaendert', details);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- Projekt kopieren (PRJ-04) ----------------
router.post('/projects/:projectId/copy', requireProject('read'), (req, res, next) => {
  try {
    const src = req.project;
    const name = (req.body && req.body.name) || `${src.name} (Kopie)`;
    const projectId = tx(() => {
      const r = run(
        `INSERT INTO projects (name, geraetetyp, gebaeude, ebene, budget, beschreibung, status, template_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'aktiv', ?, ?, ?)`,
        name, src.geraetetyp, src.gebaeude, src.ebene, src.budget, src.beschreibung, src.template_id, req.user.id, now());
      const newId = Number(r.lastInsertRowid);
      run('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)', newId, req.user.id, 'projektleiter');

      const phaseMap = {};
      for (const ph of all('SELECT * FROM phases WHERE project_id = ? ORDER BY sort_order', src.id)) {
        const pr = run('INSERT INTO phases (project_id, nr, name, sort_order) VALUES (?, ?, ?, ?)', newId, ph.nr, ph.name, ph.sort_order);
        phaseMap[ph.id] = Number(pr.lastInsertRowid);
      }
      // Punkte: Relevanzbewertung bleibt, Bearbeitungsstand wird zurückgesetzt
      for (const c of all('SELECT * FROM checkpoints WHERE project_id = ?', src.id)) {
        run(`INSERT INTO checkpoints (project_id, phase_id, nr, text, gewerke, fuehrend, hinweis, relevanz, relevanz_begruendung, prio, is_custom, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          newId, phaseMap[c.phase_id], c.nr, c.text, c.gewerke, c.fuehrend, c.hinweis,
          c.relevanz, c.relevanz_begruendung, c.prio, c.is_custom, now(), now());
      }
      // Räume samt Soll-Werten; Ist-Werte werden geleert
      for (const room of all('SELECT * FROM rooms WHERE project_id = ?', src.id)) {
        const rr = run(`INSERT INTO rooms (project_id, nummer, bezeichnung, funktion, flaeche_m2, hoehe_m, raumgruppe, strahlenschutz, hf_anforderung, raumtyp, bemerkung, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          newId, room.nummer, room.bezeichnung, room.funktion, room.flaeche_m2, room.hoehe_m,
          room.raumgruppe, room.strahlenschutz, room.hf_anforderung, room.raumtyp, room.bemerkung, now());
        const newRoomId = Number(rr.lastInsertRowid);
        for (const a of all('SELECT * FROM room_attributes WHERE room_id = ? ORDER BY sort_order', room.id)) {
          run(`INSERT INTO room_attributes (room_id, gewerk, name, datentyp, einheit, soll, ist, status, quelle, sort_order)
               VALUES (?, ?, ?, ?, ?, ?, NULL, 'offen', ?, ?)`,
            newRoomId, a.gewerk, a.name, a.datentyp, a.einheit, a.soll, a.quelle, a.sort_order);
        }
      }
      // Dokumentenregister: Benötigt-Bewertung bleibt, Erhalten wird geleert
      for (const d of all('SELECT * FROM document_entries WHERE project_id = ?', src.id)) {
        run(`INSERT INTO document_entries (project_id, bereich, nr, titel, gewerk, beschreibung, benoetigt, begruendung, is_custom)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          newId, d.bereich, d.nr, d.titel, d.gewerk, d.beschreibung, d.benoetigt, d.begruendung, d.is_custom);
      }
      for (const m of all('SELECT * FROM milestones WHERE project_id = ? ORDER BY sort_order', src.id)) {
        run('INSERT INTO milestones (project_id, name, sort_order) VALUES (?, ?, ?)', newId, m.name, m.sort_order);
      }
      for (const k of all('SELECT * FROM contacts WHERE project_id = ?', src.id)) {
        run('INSERT INTO contacts (project_id, name, firma, rolle, gewerk, email, telefon, notiz, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          newId, k.name, k.firma, k.rolle, k.gewerk, k.email, k.telefon, k.notiz, k.user_id);
      }
      return newId;
    });
    audit(req, projectId, 'project', projectId, 'erstellt', { kopie_von: `${src.name} (#${src.id})` });
    res.status(201).json({ id: projectId });
  } catch (e) { next(e); }
});

// ---------------- Meilensteine (PRJ-03) ----------------
router.get('/projects/:projectId/milestones', requireProject('read'), (req, res) => {
  res.json(all('SELECT * FROM milestones WHERE project_id = ? ORDER BY sort_order', req.project.id));
});

router.post('/projects/:projectId/milestones', requireProject('write'), (req, res, next) => {
  const { name, datum } = req.body || {};
  if (!name) return next(new ApiError(400, 'Name ist Pflicht'));
  const maxSort = get('SELECT COALESCE(MAX(sort_order),0) AS m FROM milestones WHERE project_id = ?', req.project.id).m;
  const r = run('INSERT INTO milestones (project_id, name, datum, sort_order) VALUES (?, ?, ?, ?)',
    req.project.id, String(name), datum || null, maxSort + 1);
  audit(req, req.project.id, 'milestone', Number(r.lastInsertRowid), 'erstellt', { name });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.patch('/milestones/:id', requireAuth, requireProject('write', (req) => {
  const m = get('SELECT project_id FROM milestones WHERE id = ?', Number(req.params.id));
  return m ? m.project_id : 0;
}), (req, res, next) => {
  const m = get('SELECT * FROM milestones WHERE id = ?', Number(req.params.id));
  if (!m) return next(new ApiError(404, 'Meilenstein nicht gefunden'));
  const { name, datum, erledigt, sort_order } = req.body || {};
  run('UPDATE milestones SET name=?, datum=?, erledigt=?, sort_order=? WHERE id=?',
    name ?? m.name, datum === undefined ? m.datum : datum,
    erledigt === undefined ? m.erledigt : (erledigt ? 1 : 0), sort_order ?? m.sort_order, m.id);
  audit(req, m.project_id, 'milestone', m.id, 'geaendert');
  res.json({ ok: true });
});

router.delete('/milestones/:id', requireAuth, requireProject('write', (req) => {
  const m = get('SELECT project_id FROM milestones WHERE id = ?', Number(req.params.id));
  return m ? m.project_id : 0;
}), (req, res) => {
  const m = get('SELECT * FROM milestones WHERE id = ?', Number(req.params.id));
  run('DELETE FROM milestones WHERE id = ?', m.id);
  audit(req, m.project_id, 'milestone', m.id, 'geloescht', { name: m.name });
  res.json({ ok: true });
});

// ---------------- Projektmitglieder (ROL-02/03) ----------------
router.get('/projects/:projectId/members', requireProject('read'), (req, res) => {
  res.json(all(
    `SELECT m.*, u.username, u.display_name FROM project_members m JOIN users u ON u.id = m.user_id
     WHERE m.project_id = ? ORDER BY u.display_name`, req.project.id));
});

router.post('/projects/:projectId/members', requireProject('read'), (req, res, next) => {
  try {
    if (req.access.memberRole !== 'projektleiter') throw new ApiError(403, 'Nur Projektleiter dürfen Mitglieder verwalten');
    const { user_id, role, gewerke } = req.body || {};
    const user = get('SELECT id FROM users WHERE id = ? AND active = 1', Number(user_id));
    if (!user) throw new ApiError(404, 'Nutzer nicht gefunden');
    if (!['projektleiter', 'bearbeiter', 'leser'].includes(role)) throw new ApiError(400, 'Ungültige Rolle');
    run(`INSERT INTO project_members (project_id, user_id, role, gewerke) VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, user_id) DO UPDATE SET role = excluded.role, gewerke = excluded.gewerke`,
      req.project.id, user.id, role, gewerke ? csvList(gewerke).join(',') : null);
    audit(req, req.project.id, 'project', req.project.id, 'mitglied', { user_id: user.id, role, gewerke: gewerke || 'alle' });
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/projects/:projectId/members/:userId', requireProject('read'), (req, res, next) => {
  try {
    if (req.access.memberRole !== 'projektleiter') throw new ApiError(403, 'Nur Projektleiter dürfen Mitglieder verwalten');
    if (Number(req.params.userId) === req.user.id) throw new ApiError(400, 'Eigene Mitgliedschaft kann nicht entfernt werden');
    run('DELETE FROM project_members WHERE project_id = ? AND user_id = ?', req.project.id, Number(req.params.userId));
    audit(req, req.project.id, 'project', req.project.id, 'mitglied_entfernt', { user_id: Number(req.params.userId) });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- Abnahmereife-Prüfung (Workflow Schritt 6) ----------------
router.get('/projects/:projectId/abnahmereife', requireProject('read'), (req, res) => {
  const p = req.project;
  const offenePunkte = all(
    `SELECT c.id, c.nr, c.text, c.status, c.termin, c.gewerke, ph.name AS phase FROM checkpoints c
     JOIN phases ph ON ph.id = c.phase_id
     WHERE c.project_id = ? AND c.relevanz != 'nicht_relevant' AND c.status != 'erledigt'
     ORDER BY ph.sort_order, c.nr`, p.id);
  const fehlendeDokumente = all(
    `SELECT id, bereich, nr, titel, gewerk, faelligkeit FROM document_entries
     WHERE project_id = ? AND benoetigt = 'ja' AND erhalten_am IS NULL ORDER BY bereich, nr`, p.id);
  const offeneMaengel = all(
    `SELECT id, nummer, beschreibung, gewerk, frist, status FROM defects
     WHERE project_id = ? AND status != 'abgenommen' ORDER BY nummer`, p.id);
  res.json({
    bereit: offenePunkte.length === 0 && fehlendeDokumente.length === 0 && offeneMaengel.length === 0,
    offene_punkte: offenePunkte,
    fehlende_dokumente: fehlendeDokumente,
    offene_maengel: offeneMaengel,
  });
});

module.exports = router;
