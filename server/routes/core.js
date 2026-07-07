// Querschnittsfunktionen: Gewerke-Katalog, Kommentare, Anhänge, Verknüpfungen,
// gespeicherte Ansichten, Audit-Trail-Einsicht
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const { get, all, run } = require('../db');
const { UPLOAD_DIR } = require('../db');
const { now, ApiError, randomToken } = require('../util');
const { audit } = require('../audit');
const { requireAuth, requireAdmin, requireProject, projectAccess } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Erlaubte Dateitypen und -größen (DOK-06)
const ALLOWED_EXT = new Set(['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'msg', 'eml', 'dwg', 'ifc', 'zip']);
const MAX_FILE_MB = Number(process.env.GGP_MAX_FILE_MB || 50);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${randomToken(8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (!ALLOWED_EXT.has(ext)) return cb(new ApiError(400, `Dateityp .${ext} ist nicht zugelassen`));
    cb(null, true);
  },
});

// Objekt-Typen, deren project_id ermittelbar ist (für Rechteprüfung bei Querschnittsobjekten)
const OBJECT_TABLES = {
  checkpoint: 'checkpoints', room: 'rooms', document: 'document_entries',
  meeting: 'meetings', protocol_item: 'protocol_items', task: 'tasks',
  defect: 'defects', journal: 'journal_entries', contact: 'contacts', photo: 'photos',
  planstand: 'plan_states', project: 'projects',
};

function objectProject(typ, id) {
  const table = OBJECT_TABLES[typ];
  if (!table) throw new ApiError(400, `Unbekannter Objekttyp '${typ}'`);
  const row = typ === 'project'
    ? get('SELECT id AS project_id FROM projects WHERE id = ?', Number(id))
    : get(`SELECT project_id FROM ${table} WHERE id = ?`, Number(id));
  if (!row) throw new ApiError(404, 'Objekt nicht gefunden');
  return row.project_id;
}

function checkObjectAccess(req, typ, id, mode = 'read') {
  const projectId = objectProject(typ, id);
  if (projectId == null) return null; // projektfreie Objekte (z. B. persönliche Aufgaben)
  const access = projectAccess(req.user, projectId);
  if (!access) throw new ApiError(404, 'Objekt nicht gefunden');
  if (mode === 'write') {
    if (access.memberRole === 'leser') throw new ApiError(403, 'Keine Schreibrechte');
    if (access.project.status === 'archiviert') throw new ApiError(403, 'Projekt ist archiviert (schreibgeschützt)');
  }
  return projectId;
}

// ---------------- Gewerke (zentraler Katalog) ----------------
router.get('/gewerke', (req, res) => {
  res.json(all('SELECT * FROM gewerke WHERE active = 1 ORDER BY sort_order, kuerzel'));
});

router.post('/gewerke', requireAdmin, (req, res, next) => {
  const { kuerzel, name, farbe } = req.body || {};
  if (!kuerzel || !name || !farbe) return next(new ApiError(400, 'kuerzel, name und farbe sind Pflicht'));
  if (get('SELECT id FROM gewerke WHERE kuerzel = ?', kuerzel)) return next(new ApiError(409, 'Kürzel bereits vorhanden'));
  const maxSort = get('SELECT COALESCE(MAX(sort_order),0) AS m FROM gewerke').m;
  const r = run('INSERT INTO gewerke (kuerzel, name, farbe, sort_order) VALUES (?, ?, ?, ?)', kuerzel, name, farbe, maxSort + 1);
  audit(req, null, 'gewerk', Number(r.lastInsertRowid), 'erstellt', { kuerzel });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.patch('/gewerke/:id', requireAdmin, (req, res, next) => {
  const g = get('SELECT * FROM gewerke WHERE id = ?', Number(req.params.id));
  if (!g) return next(new ApiError(404, 'Gewerk nicht gefunden'));
  const { name, farbe, sort_order, active } = req.body || {};
  run('UPDATE gewerke SET name = ?, farbe = ?, sort_order = ?, active = ? WHERE id = ?',
    name ?? g.name, farbe ?? g.farbe, sort_order ?? g.sort_order,
    active === undefined ? g.active : (active ? 1 : 0), g.id);
  audit(req, null, 'gewerk', g.id, 'geaendert');
  res.json({ ok: true });
});

// ---------------- Kommentare (CHK-05 u. a.) ----------------
router.get('/comments', (req, res, next) => {
  try {
    const { object_typ, object_id } = req.query;
    checkObjectAccess(req, object_typ, object_id, 'read');
    res.json(all(
      `SELECT c.*, u.display_name AS user_name FROM comments c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.object_typ = ? AND c.object_id = ? ORDER BY c.created_at`,
      object_typ, Number(object_id)));
  } catch (e) { next(e); }
});

router.post('/comments', (req, res, next) => {
  try {
    const { object_typ, object_id, text } = req.body || {};
    if (!text || !String(text).trim()) throw new ApiError(400, 'Kommentartext fehlt');
    const projectId = checkObjectAccess(req, object_typ, object_id, 'write');
    const r = run('INSERT INTO comments (object_typ, object_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
      object_typ, Number(object_id), req.user.id, String(text).trim(), now());
    audit(req, projectId, object_typ, Number(object_id), 'kommentar', { text: String(text).slice(0, 200) });
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) { next(e); }
});

// ---------------- Anhänge ----------------
router.post('/attachments', upload.single('datei'), (req, res, next) => {
  try {
    const { object_typ, object_id } = req.body || {};
    if (!req.file) throw new ApiError(400, 'Keine Datei übermittelt');
    const projectId = checkObjectAccess(req, object_typ, object_id, 'write');
    const r = run(
      `INSERT INTO attachments (object_typ, object_id, filename, path, mime, size, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      object_typ, Number(object_id), req.file.originalname, path.basename(req.file.path),
      req.file.mimetype, req.file.size, req.user.id, now());
    audit(req, projectId, object_typ, Number(object_id), 'anhang', { datei: req.file.originalname });
    res.status(201).json({ id: Number(r.lastInsertRowid), filename: req.file.originalname });
  } catch (e) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(e);
  }
});

router.get('/attachments', (req, res, next) => {
  try {
    const { object_typ, object_id } = req.query;
    checkObjectAccess(req, object_typ, object_id, 'read');
    res.json(all('SELECT id, object_typ, object_id, filename, mime, size, created_at FROM attachments WHERE object_typ = ? AND object_id = ? ORDER BY created_at',
      object_typ, Number(object_id)));
  } catch (e) { next(e); }
});

router.get('/attachments/:id/download', (req, res, next) => {
  try {
    const a = get('SELECT * FROM attachments WHERE id = ?', Number(req.params.id));
    if (!a) throw new ApiError(404, 'Anhang nicht gefunden');
    checkObjectAccess(req, a.object_typ, a.object_id, 'read');
    res.download(path.join(UPLOAD_DIR, a.path), a.filename);
  } catch (e) { next(e); }
});

// ---------------- Verknüpfungen (Kap. 5 Verknüpfungsprinzip) ----------------
router.get('/links', (req, res, next) => {
  try {
    const { typ, id } = req.query;
    checkObjectAccess(req, typ, id, 'read');
    const rows = all(
      `SELECT * FROM links WHERE (from_typ = ? AND from_id = ?) OR (to_typ = ? AND to_id = ?)`,
      typ, Number(id), typ, Number(id));
    // Aus Sicht des angefragten Objekts normalisieren + Zielbezeichnung auflösen
    const out = rows.map((l) => {
      const isFrom = l.from_typ === typ && l.from_id === Number(id);
      const otherTyp = isFrom ? l.to_typ : l.from_typ;
      const otherId = isFrom ? l.to_id : l.from_id;
      return { id: l.id, typ: otherTyp, object_id: otherId, label: resolveLabel(otherTyp, otherId) };
    });
    res.json(out);
  } catch (e) { next(e); }
});

function resolveLabel(typ, id) {
  const q = {
    checkpoint: 'SELECT nr || \' \' || substr(text,1,80) AS l FROM checkpoints WHERE id = ?',
    room: 'SELECT nummer || \' \' || bezeichnung AS l FROM rooms WHERE id = ?',
    document: 'SELECT nr || \' \' || titel AS l FROM document_entries WHERE id = ?',
    meeting: 'SELECT titel || \' (\' || datum || \')\' AS l FROM meetings WHERE id = ?',
    protocol_item: 'SELECT code || \' \' || substr(text,1,80) AS l FROM protocol_items WHERE id = ?',
    task: 'SELECT titel AS l FROM tasks WHERE id = ?',
    defect: 'SELECT \'M-\' || printf(\'%03d\', nummer) || \' \' || substr(beschreibung,1,80) AS l FROM defects WHERE id = ?',
    journal: 'SELECT datum || \' \' || substr(text,1,80) AS l FROM journal_entries WHERE id = ?',
    contact: 'SELECT name AS l FROM contacts WHERE id = ?',
    photo: 'SELECT filename AS l FROM photos WHERE id = ?',
    planstand: 'SELECT name AS l FROM plan_states WHERE id = ?',
  }[typ];
  if (!q) return `${typ} #${id}`;
  const row = get(q, Number(id));
  return row ? row.l : `${typ} #${id} (gelöscht)`;
}

router.post('/links', (req, res, next) => {
  try {
    const { from_typ, from_id, to_typ, to_id } = req.body || {};
    const p1 = checkObjectAccess(req, from_typ, from_id, 'write');
    checkObjectAccess(req, to_typ, to_id, 'read');
    const existing = get(
      `SELECT id FROM links WHERE (from_typ=? AND from_id=? AND to_typ=? AND to_id=?)
       OR (from_typ=? AND from_id=? AND to_typ=? AND to_id=?)`,
      from_typ, Number(from_id), to_typ, Number(to_id),
      to_typ, Number(to_id), from_typ, Number(from_id));
    if (existing) return res.json({ id: existing.id, existing: true });
    const r = run('INSERT INTO links (project_id, from_typ, from_id, to_typ, to_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      p1, from_typ, Number(from_id), to_typ, Number(to_id), req.user.id, now());
    audit(req, p1, from_typ, Number(from_id), 'verknuepft', { mit: `${to_typ}#${to_id}` });
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.delete('/links/:id', (req, res, next) => {
  try {
    const l = get('SELECT * FROM links WHERE id = ?', Number(req.params.id));
    if (!l) throw new ApiError(404, 'Verknüpfung nicht gefunden');
    checkObjectAccess(req, l.from_typ, l.from_id, 'write');
    run('DELETE FROM links WHERE id = ?', l.id);
    audit(req, l.project_id, l.from_typ, l.from_id, 'verknuepfung_geloescht', { mit: `${l.to_typ}#${l.to_id}` });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Zielsuche für den Verknüpfungsdialog: Objekte eines Projekts nach Typ und Text
router.get('/projects/:projectId/link-targets', requireProject('read'), (req, res, next) => {
  try {
    const typ = String(req.query.typ || '');
    const q = `%${String(req.query.q || '').trim()}%`;
    const pid = req.project.id;
    const queries = {
      checkpoint: `SELECT id, nr || ' ' || substr(text,1,80) AS label FROM checkpoints WHERE project_id = ? AND (nr LIKE ? OR text LIKE ?) ORDER BY nr LIMIT 20`,
      room: `SELECT id, nummer || ' ' || bezeichnung AS label FROM rooms WHERE project_id = ? AND (nummer LIKE ? OR bezeichnung LIKE ?) ORDER BY nummer LIMIT 20`,
      document: `SELECT id, nr || ' ' || titel AS label FROM document_entries WHERE project_id = ? AND (nr LIKE ? OR titel LIKE ?) ORDER BY bereich, nr LIMIT 20`,
      meeting: `SELECT id, titel || ' (' || datum || ')' AS label FROM meetings WHERE project_id = ? AND (titel LIKE ? OR datum LIKE ?) ORDER BY datum DESC LIMIT 20`,
      protocol_item: `SELECT id, code || ' ' || substr(text,1,80) AS label FROM protocol_items WHERE project_id = ? AND (code LIKE ? OR text LIKE ?) ORDER BY id DESC LIMIT 20`,
      task: `SELECT id, titel AS label FROM tasks WHERE project_id = ? AND (titel LIKE ? OR COALESCE(beschreibung,'') LIKE ?) ORDER BY id DESC LIMIT 20`,
      defect: `SELECT id, 'M-' || printf('%03d', nummer) || ' ' || substr(beschreibung,1,80) AS label FROM defects WHERE project_id = ? AND (beschreibung LIKE ? OR firma LIKE ?) ORDER BY nummer LIMIT 20`,
      journal: `SELECT id, datum || ' ' || substr(text,1,80) AS label FROM journal_entries WHERE project_id = ? AND (text LIKE ? OR datum LIKE ?) ORDER BY datum DESC LIMIT 20`,
    };
    if (!queries[typ]) throw new ApiError(400, 'Unbekannter Zieltyp');
    res.json(all(queries[typ], pid, q, q));
  } catch (e) { next(e); }
});

// ---------------- Gespeicherte Ansichten (CHK-03) ----------------
router.get('/views', (req, res) => {
  const { modul } = req.query;
  res.json(modul
    ? all('SELECT * FROM saved_views WHERE user_id = ? AND modul = ? ORDER BY name', req.user.id, modul)
    : all('SELECT * FROM saved_views WHERE user_id = ? ORDER BY modul, name', req.user.id));
});

router.post('/views', (req, res, next) => {
  const { modul, name, filter } = req.body || {};
  if (!modul || !name || filter === undefined) return next(new ApiError(400, 'modul, name und filter sind Pflicht'));
  const r = run('INSERT INTO saved_views (user_id, modul, name, filter, created_at) VALUES (?, ?, ?, ?, ?)',
    req.user.id, String(modul), String(name), JSON.stringify(filter), now());
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.delete('/views/:id', (req, res, next) => {
  const v = get('SELECT * FROM saved_views WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!v) return next(new ApiError(404, 'Ansicht nicht gefunden'));
  run('DELETE FROM saved_views WHERE id = ?', v.id);
  res.json({ ok: true });
});

// ---------------- Audit-Trail (Einsicht) ----------------
router.get('/audit', (req, res, next) => {
  try {
    const { object_typ, object_id, project_id } = req.query;
    if (object_typ && object_id) {
      checkObjectAccess(req, object_typ, object_id, 'read');
      return res.json(all('SELECT * FROM audit_trail WHERE object_typ = ? AND object_id = ? ORDER BY timestamp, id',
        object_typ, Number(object_id)));
    }
    if (project_id) {
      const access = projectAccess(req.user, Number(project_id));
      if (!access) throw new ApiError(404, 'Projekt nicht gefunden');
      return res.json(all('SELECT * FROM audit_trail WHERE project_id = ? ORDER BY timestamp DESC, id DESC LIMIT 500', Number(project_id)));
    }
    throw new ApiError(400, 'object_typ+object_id oder project_id angeben');
  } catch (e) { next(e); }
});

module.exports = router;
module.exports.checkObjectAccess = checkObjectAccess;
module.exports.resolveLabel = resolveLabel;
module.exports.upload = upload;
