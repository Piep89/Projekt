// M6 – Projektjournal/Bautagebuch (NOT-03) und Fotodokumentation (NOT-04)
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { get, all, run, UPLOAD_DIR } = require('../db');
const { now, today, ApiError } = require('../util');
const { audit, diff } = require('../audit');
const { requireAuth, requireProject, projectAccess } = require('../auth');
const { upload } = require('./core');

const router = express.Router();
router.use(requireAuth);

const KATEGORIEN = ['baustelle', 'planung', 'telefonat', 'begehung', 'sonstig'];
const istDatum = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s));

// Sperr-Regel (NOT-03): editierbar, solange heute <= Eintragsdatum + 1 Tag
function istEditierbar(datum) {
  const d = new Date(String(datum) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return false;
  const grenze = new Date(d.getTime() + 86400e3).toISOString().slice(0, 10);
  return today() <= grenze;
}

function journalProjekt(req) {
  const e = get('SELECT project_id FROM journal_entries WHERE id = ?', Number(req.params.id));
  return e ? e.project_id : 0;
}

function fotosZu(journalId) {
  return all(
    `SELECT id, filename, mime, size, aufnahme_zeit, beschreibung, room_id, checkpoint_id, mangel_id, journal_id
     FROM photos WHERE journal_id = ? ORDER BY aufnahme_zeit, id`, journalId);
}

// ---------------- Journal lesen ----------------
router.get('/projects/:projectId/journal', requireProject('read'), (req, res, next) => {
  try {
    const { von, bis, kategorie } = req.query;
    const q = String(req.query.q || '').trim().toLowerCase();
    if (von && !istDatum(von)) throw new ApiError(400, 'von muss im Format JJJJ-MM-TT sein');
    if (bis && !istDatum(bis)) throw new ApiError(400, 'bis muss im Format JJJJ-MM-TT sein');
    if (kategorie && !KATEGORIEN.includes(kategorie)) throw new ApiError(400, 'Ungültige Kategorie');

    const where = ['j.project_id = ?', 'j.nachtrag_zu IS NULL'];
    const params = [req.project.id];
    if (von) { where.push('j.datum >= ?'); params.push(von); }
    if (bis) { where.push('j.datum <= ?'); params.push(bis); }
    if (kategorie) { where.push('j.kategorie = ?'); params.push(kategorie); }

    const eintraege = all(
      `SELECT j.*, u.display_name AS verfasser_name FROM journal_entries j
       LEFT JOIN users u ON u.id = j.verfasser_id
       WHERE ${where.join(' AND ')} ORDER BY j.datum DESC, j.id DESC`, ...params);

    const nachtraege = all(
      `SELECT j.*, u.display_name AS verfasser_name FROM journal_entries j
       LEFT JOIN users u ON u.id = j.verfasser_id
       WHERE j.project_id = ? AND j.nachtrag_zu IS NOT NULL ORDER BY j.datum, j.id`, req.project.id);
    const nachtragMap = {};
    for (const n of nachtraege) {
      (nachtragMap[n.nachtrag_zu] = nachtragMap[n.nachtrag_zu] || []).push({
        ...n, editierbar: istEditierbar(n.datum), fotos: fotosZu(n.id),
      });
    }

    let result = eintraege.map((e) => ({
      ...e,
      verfasser_name: e.verfasser_name || '—',
      editierbar: istEditierbar(e.datum),
      fotos: fotosZu(e.id),
      nachtraege: nachtragMap[e.id] || [],
    }));

    if (q) {
      result = result.filter((e) =>
        [e.text, e.anwesende, e.wetter, ...e.nachtraege.map((n) => n.text)]
          .some((s) => String(s || '').toLowerCase().includes(q)));
    }
    res.json(result);
  } catch (e) { next(e); }
});

// ---------------- Eintrag anlegen ----------------
router.post('/projects/:projectId/journal', requireProject('write'), (req, res, next) => {
  try {
    const b = req.body || {};
    const text = String(b.text || '').trim();
    if (!text) throw new ApiError(400, 'Text ist Pflicht');
    const datum = b.datum || today();
    if (!istDatum(datum)) throw new ApiError(400, 'Datum muss im Format JJJJ-MM-TT sein');
    const kategorie = b.kategorie || 'baustelle';
    if (!KATEGORIEN.includes(kategorie)) throw new ApiError(400, 'Ungültige Kategorie');

    const r = run(
      `INSERT INTO journal_entries (project_id, datum, kategorie, text, wetter, anwesende, verfasser_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      req.project.id, datum, kategorie, text,
      b.wetter ? String(b.wetter) : null, b.anwesende ? String(b.anwesende) : null, req.user.id, now());
    const id = Number(r.lastInsertRowid);
    audit(req, req.project.id, 'journal', id, 'erstellt', { datum, kategorie });
    res.status(201).json({ id });
  } catch (e) { next(e); }
});

// ---------------- Eintrag ändern (nur im Bearbeitungsfenster) ----------------
router.patch('/journal/:id', requireProject('write', journalProjekt), (req, res, next) => {
  try {
    const e = get('SELECT * FROM journal_entries WHERE id = ?', Number(req.params.id));
    if (!e) throw new ApiError(404, 'Journaleintrag nicht gefunden');
    if (!istEditierbar(e.datum)) throw new ApiError(403, 'Eintrag ist abgeschlossen – Korrektur nur als Nachtrag');
    if (e.verfasser_id !== req.user.id && req.access.memberRole !== 'projektleiter') {
      throw new ApiError(403, 'Nur Verfasser oder Projektleiter dürfen den Eintrag bearbeiten');
    }
    const b = req.body || {};
    if (b.text !== undefined && !String(b.text).trim()) throw new ApiError(400, 'Text darf nicht leer sein');
    if (b.kategorie !== undefined && !KATEGORIEN.includes(b.kategorie)) throw new ApiError(400, 'Ungültige Kategorie');

    const neu = {
      text: b.text !== undefined ? String(b.text).trim() : e.text,
      kategorie: b.kategorie !== undefined ? b.kategorie : e.kategorie,
      wetter: b.wetter !== undefined ? (b.wetter ? String(b.wetter) : null) : e.wetter,
      anwesende: b.anwesende !== undefined ? (b.anwesende ? String(b.anwesende) : null) : e.anwesende,
    };
    run('UPDATE journal_entries SET text=?, kategorie=?, wetter=?, anwesende=? WHERE id=?',
      neu.text, neu.kategorie, neu.wetter, neu.anwesende, e.id);
    audit(req, e.project_id, 'journal', e.id, 'geaendert', diff(e, neu, ['text', 'kategorie', 'wetter', 'anwesende']));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ---------------- Nachtrag (NOT-03) ----------------
router.post('/journal/:id/nachtrag', requireProject('write', journalProjekt), (req, res, next) => {
  try {
    const e = get('SELECT * FROM journal_entries WHERE id = ?', Number(req.params.id));
    if (!e) throw new ApiError(404, 'Journaleintrag nicht gefunden');
    const text = String((req.body || {}).text || '').trim();
    if (!text) throw new ApiError(400, 'Text ist Pflicht');
    const originalId = e.nachtrag_zu || e.id; // Nachträge hängen immer am Original
    const r = run(
      `INSERT INTO journal_entries (project_id, datum, kategorie, text, nachtrag_zu, verfasser_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      e.project_id, today(), e.kategorie, text, originalId, req.user.id, now());
    const id = Number(r.lastInsertRowid);
    audit(req, e.project_id, 'journal', id, 'erstellt', { nachtrag_zu: originalId });
    res.status(201).json({ id });
  } catch (err) { next(err); }
});

// ============================================================
// Fotos (NOT-04)
// ============================================================

// Zuordnungsfelder prüfen: referenzierte Objekte müssen zum Projekt gehören
function pruefeFotoBezug(projectId, b) {
  const refs = [
    ['room_id', 'rooms', 'Raum'],
    ['checkpoint_id', 'checkpoints', 'Checkpunkt'],
    ['mangel_id', 'defects', 'Mangel'],
    ['journal_id', 'journal_entries', 'Journaleintrag'],
  ];
  const out = {};
  for (const [feld, tabelle, name] of refs) {
    if (b[feld] === undefined) continue;
    if (b[feld] === null || b[feld] === '') { out[feld] = null; continue; }
    const id = Number(b[feld]);
    if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `Ungültige ${name}-ID`);
    const row = get(`SELECT project_id FROM ${tabelle} WHERE id = ?`, id);
    if (!row || row.project_id !== projectId) throw new ApiError(400, `${name} gehört nicht zu diesem Projekt`);
    out[feld] = id;
  }
  return out;
}

// ---------------- Fotos hochladen ----------------
router.post('/projects/:projectId/photos', requireProject('write'), upload.array('fotos', 10), (req, res, next) => {
  const files = req.files || [];
  try {
    if (!files.length) throw new ApiError(400, 'Keine Fotos übermittelt');
    for (const f of files) {
      if (!String(f.mimetype || '').startsWith('image/')) {
        throw new ApiError(400, `'${f.originalname}' ist kein Bild – nur Bilddateien sind zugelassen`);
      }
    }
    const bezug = pruefeFotoBezug(req.project.id, req.body || {});
    const beschreibung = (req.body && req.body.beschreibung) ? String(req.body.beschreibung) : null;
    const zeit = now(); // NOT-04: automatischer Zeitstempel
    const fotos = files.map((f) => {
      const r = run(
        `INSERT INTO photos (project_id, filename, path, mime, size, aufnahme_zeit, beschreibung,
           room_id, checkpoint_id, mangel_id, journal_id, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.project.id, f.originalname, path.basename(f.path), f.mimetype, f.size, zeit, beschreibung,
        bezug.room_id ?? null, bezug.checkpoint_id ?? null, bezug.mangel_id ?? null, bezug.journal_id ?? null,
        req.user.id, zeit);
      const id = Number(r.lastInsertRowid);
      audit(req, req.project.id, 'photo', id, 'erstellt', { datei: f.originalname, ...bezug });
      return { id, filename: f.originalname };
    });
    res.status(201).json({ fotos });
  } catch (e) {
    for (const f of files) fs.unlink(f.path, () => {});
    next(e);
  }
});

// ---------------- Fotogalerie (je Projekt, filterbar) ----------------
router.get('/projects/:projectId/photos', requireProject('read'), (req, res, next) => {
  try {
    const where = ['project_id = ?'];
    const params = [req.project.id];
    for (const feld of ['room_id', 'journal_id', 'mangel_id', 'checkpoint_id']) {
      if (req.query[feld]) {
        const id = Number(req.query[feld]);
        if (!Number.isInteger(id) || id <= 0) throw new ApiError(400, `Ungültiger Filter ${feld}`);
        where.push(`${feld} = ?`); params.push(id);
      }
    }
    res.json(all(
      `SELECT id, filename, mime, size, aufnahme_zeit, beschreibung, room_id, checkpoint_id, mangel_id, journal_id, uploaded_by
       FROM photos WHERE ${where.join(' AND ')} ORDER BY aufnahme_zeit DESC, id DESC`, ...params));
  } catch (e) { next(e); }
});

// ---------------- Bilddatei ausliefern (Projektzugriff erforderlich) ----------------
router.get('/photos/:id/datei', (req, res, next) => {
  try {
    const foto = get('SELECT * FROM photos WHERE id = ?', Number(req.params.id));
    if (!foto) throw new ApiError(404, 'Foto nicht gefunden');
    if (!projectAccess(req.user, foto.project_id)) throw new ApiError(404, 'Foto nicht gefunden');
    const datei = path.join(UPLOAD_DIR, foto.path);
    if (!fs.existsSync(datei)) throw new ApiError(404, 'Bilddatei nicht vorhanden');
    res.setHeader('Content-Type', foto.mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(datei);
  } catch (e) { next(e); }
});

// ---------------- Foto ändern (Beschreibung/Zuordnung) ----------------
router.patch('/photos/:id', requireProject('write', (req) => {
  const f = get('SELECT project_id FROM photos WHERE id = ?', Number(req.params.id));
  return f ? f.project_id : 0;
}), (req, res, next) => {
  try {
    const foto = get('SELECT * FROM photos WHERE id = ?', Number(req.params.id));
    if (!foto) throw new ApiError(404, 'Foto nicht gefunden');
    const b = req.body || {};
    const bezug = pruefeFotoBezug(foto.project_id, b);
    const neu = {
      beschreibung: b.beschreibung !== undefined ? (b.beschreibung ? String(b.beschreibung) : null) : foto.beschreibung,
      room_id: 'room_id' in bezug ? bezug.room_id : foto.room_id,
      checkpoint_id: 'checkpoint_id' in bezug ? bezug.checkpoint_id : foto.checkpoint_id,
      mangel_id: 'mangel_id' in bezug ? bezug.mangel_id : foto.mangel_id,
    };
    run('UPDATE photos SET beschreibung=?, room_id=?, checkpoint_id=?, mangel_id=? WHERE id=?',
      neu.beschreibung, neu.room_id, neu.checkpoint_id, neu.mangel_id, foto.id);
    audit(req, foto.project_id, 'photo', foto.id, 'geaendert',
      diff(foto, neu, ['beschreibung', 'room_id', 'checkpoint_id', 'mangel_id']));
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- Foto löschen ----------------
router.delete('/photos/:id', requireProject('write', (req) => {
  const f = get('SELECT project_id FROM photos WHERE id = ?', Number(req.params.id));
  return f ? f.project_id : 0;
}), (req, res, next) => {
  try {
    const foto = get('SELECT * FROM photos WHERE id = ?', Number(req.params.id));
    if (!foto) throw new ApiError(404, 'Foto nicht gefunden');
    if (foto.uploaded_by !== req.user.id && req.access.memberRole !== 'projektleiter') {
      throw new ApiError(403, 'Nur Uploader oder Projektleiter dürfen Fotos löschen');
    }
    run('DELETE FROM photos WHERE id = ?', foto.id);
    fs.unlink(path.join(UPLOAD_DIR, foto.path), () => {});
    audit(req, foto.project_id, 'photo', foto.id, 'geloescht', { datei: foto.filename });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
