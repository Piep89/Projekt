// M7 – Mängelmanagement (MGL-01 … MGL-03)
const express = require('express');
const { get, all, run, tx } = require('../db');
const { now, ApiError } = require('../util');
const { audit } = require('../audit');
const { requireAuth, requireProject, canWriteGewerk } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const STATUS_FOLGE = ['offen', 'in_behebung', 'behoben', 'abgenommen'];
const mangelProjekt = (req) => get('SELECT project_id FROM defects WHERE id = ?', Number(req.params.id))?.project_id ?? 0;
const code = (nummer) => `M-${String(nummer).padStart(3, '0')}`;

router.get('/projects/:projectId/maengel', requireProject('read'), (req, res) => {
  const { gewerk, firma, status, raum } = req.query;
  const bedingungen = ['d.project_id = ?'];
  const params = [req.project.id];
  if (gewerk) { bedingungen.push('d.gewerk = ?'); params.push(gewerk); }
  if (firma) { bedingungen.push('d.firma = ?'); params.push(firma); }
  if (status) { bedingungen.push('d.status = ?'); params.push(status); }
  if (raum) { bedingungen.push('d.room_id = ?'); params.push(Number(raum)); }
  const rows = all(
    `SELECT d.*, r.nummer AS raum_nummer, r.bezeichnung AS raum_bezeichnung,
       (SELECT COUNT(*) FROM photos p WHERE p.mangel_id = d.id) AS foto_anzahl
     FROM defects d LEFT JOIN rooms r ON r.id = d.room_id
     WHERE ${bedingungen.join(' AND ')} ORDER BY d.nummer`, ...params);
  res.json(rows.map((d) => ({ ...d, code: code(d.nummer) })));
});

router.get('/projects/:projectId/maengel-firmen', requireProject('read'), (req, res) => {
  res.json(all("SELECT DISTINCT firma FROM defects WHERE project_id = ? AND firma IS NOT NULL AND firma != '' ORDER BY firma", req.project.id)
    .map((r) => r.firma));
});

router.post('/projects/:projectId/maengel', requireProject('write'), (req, res, next) => {
  try {
    const { beschreibung, room_id, gewerk, firma, frist, photo_ids } = req.body || {};
    if (!beschreibung || !String(beschreibung).trim()) throw new ApiError(400, 'Beschreibung ist Pflicht');
    if (!canWriteGewerk(req.access, gewerk || '')) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');
    if (room_id && !get('SELECT id FROM rooms WHERE id = ? AND project_id = ?', Number(room_id), req.project.id)) {
      throw new ApiError(400, 'Raum gehört nicht zu diesem Projekt');
    }
    const id = tx(() => {
      const nummer = (get('SELECT COALESCE(MAX(nummer),0) AS m FROM defects WHERE project_id = ?', req.project.id).m) + 1;
      const r = run(
        `INSERT INTO defects (project_id, nummer, beschreibung, room_id, gewerk, firma, frist, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'offen', ?, ?)`,
        req.project.id, nummer, String(beschreibung).trim(), room_id ? Number(room_id) : null,
        gewerk || null, firma || null, frist || null, req.user.id, now());
      const mangelId = Number(r.lastInsertRowid);
      // MGL-03: vorhandene Fotos (z. B. vom Baustellenrundgang) direkt zuordnen
      for (const pid of Array.isArray(photo_ids) ? photo_ids : []) {
        run('UPDATE photos SET mangel_id = ? WHERE id = ? AND project_id = ?', mangelId, Number(pid), req.project.id);
      }
      return mangelId;
    });
    audit(req, req.project.id, 'defect', id, 'erstellt', { beschreibung: String(beschreibung).slice(0, 200), gewerk, firma });
    res.status(201).json({ id, code: code(get('SELECT nummer FROM defects WHERE id = ?', id).nummer) });
  } catch (e) { next(e); }
});

router.get('/maengel/:id', requireProject('read', mangelProjekt), (req, res) => {
  const d = get(
    `SELECT d.*, r.nummer AS raum_nummer, r.bezeichnung AS raum_bezeichnung
     FROM defects d LEFT JOIN rooms r ON r.id = d.room_id WHERE d.id = ?`, Number(req.params.id));
  const fotos = all('SELECT id, filename, beschreibung, aufnahme_zeit FROM photos WHERE mangel_id = ?', d.id);
  res.json({ ...d, code: code(d.nummer), fotos });
});

router.patch('/maengel/:id', requireProject('write', mangelProjekt), (req, res, next) => {
  try {
    const d = get('SELECT * FROM defects WHERE id = ?', Number(req.params.id));
    if (!canWriteGewerk(req.access, d.gewerk || '')) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');
    const { beschreibung, room_id, gewerk, firma, frist, status } = req.body || {};
    if (status && status !== d.status) {
      const von = STATUS_FOLGE.indexOf(d.status);
      const nach = STATUS_FOLGE.indexOf(status);
      if (nach < 0) throw new ApiError(400, 'Ungültiger Status');
      const nachbesserung = d.status === 'behoben' && status === 'in_behebung';
      if (nach < von && !nachbesserung) throw new ApiError(400, 'Statuswechsel nur vorwärts möglich (Ausnahme: Behoben → In Behebung bei Nachbesserung)');
    }
    if (room_id !== undefined && room_id !== null && !get('SELECT id FROM rooms WHERE id = ? AND project_id = ?', Number(room_id), d.project_id)) {
      throw new ApiError(400, 'Raum gehört nicht zu diesem Projekt');
    }
    const neu = {
      beschreibung: beschreibung ?? d.beschreibung, room_id: room_id === undefined ? d.room_id : (room_id ? Number(room_id) : null),
      gewerk: gewerk ?? d.gewerk, firma: firma ?? d.firma, frist: frist === undefined ? d.frist : frist,
      status: status ?? d.status,
    };
    run('UPDATE defects SET beschreibung=?, room_id=?, gewerk=?, firma=?, frist=?, status=? WHERE id=?',
      neu.beschreibung, neu.room_id, neu.gewerk, neu.firma, neu.frist, neu.status, d.id);
    if (status && status !== d.status) {
      audit(req, d.project_id, 'defect', d.id, 'status', { status: { von: d.status, nach: status } });
    } else {
      const details = {};
      for (const k of Object.keys(neu)) if (String(neu[k] ?? '') !== String(d[k] ?? '')) details[k] = { von: d[k], nach: neu[k] };
      if (Object.keys(details).length) audit(req, d.project_id, 'defect', d.id, 'geaendert', details);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Bewusst KEIN DELETE-Endpunkt: Mängel bleiben zur Nachweisführung erhalten (MGL-02).

module.exports = router;
