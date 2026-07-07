// Kontakte je Projekt (Kap. 5) inkl. CSV-Import (INT-01)
const express = require('express');
const { get, all, run } = require('../db');
const { ApiError, parseCsv } = require('../util');
const { audit } = require('../audit');
const { requireAuth, requireProject } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const kontaktProjekt = (req) => get('SELECT project_id FROM contacts WHERE id = ?', Number(req.params.id))?.project_id ?? 0;

router.get('/projects/:projectId/contacts', requireProject('read'), (req, res) => {
  const { gewerk, q } = req.query;
  const bedingungen = ['project_id = ?'];
  const params = [req.project.id];
  if (gewerk) { bedingungen.push('gewerk = ?'); params.push(gewerk); }
  if (q) {
    bedingungen.push('(name LIKE ? OR firma LIKE ? OR rolle LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  res.json(all(`SELECT * FROM contacts WHERE ${bedingungen.join(' AND ')} ORDER BY name`, ...params));
});

router.post('/projects/:projectId/contacts', requireProject('write'), (req, res, next) => {
  try {
    const { name, firma, rolle, gewerk, email, telefon, notiz } = req.body || {};
    if (!name || !String(name).trim()) throw new ApiError(400, 'Name ist Pflicht');
    const r = run('INSERT INTO contacts (project_id, name, firma, rolle, gewerk, email, telefon, notiz) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      req.project.id, String(name).trim(), firma || null, rolle || null, gewerk || null, email || null, telefon || null, notiz || null);
    audit(req, req.project.id, 'contact', Number(r.lastInsertRowid), 'erstellt', { name });
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.patch('/contacts/:id', requireProject('write', kontaktProjekt), (req, res, next) => {
  try {
    const k = get('SELECT * FROM contacts WHERE id = ?', Number(req.params.id));
    const { name, firma, rolle, gewerk, email, telefon, notiz } = req.body || {};
    if (name !== undefined && !String(name).trim()) throw new ApiError(400, 'Name darf nicht leer sein');
    run('UPDATE contacts SET name=?, firma=?, rolle=?, gewerk=?, email=?, telefon=?, notiz=? WHERE id=?',
      name ?? k.name, firma ?? k.firma, rolle ?? k.rolle, gewerk ?? k.gewerk,
      email ?? k.email, telefon ?? k.telefon, notiz ?? k.notiz, k.id);
    audit(req, k.project_id, 'contact', k.id, 'geaendert');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/contacts/:id', requireProject('write', kontaktProjekt), (req, res, next) => {
  try {
    const k = get('SELECT * FROM contacts WHERE id = ?', Number(req.params.id));
    const referenzen = [
      ['checkpoints', 'Checkpunkten'], ['protocol_items', 'Protokollpunkten'],
      ['tasks', 'Aufgaben'], ['document_entries', 'Dokumenteinträgen'],
    ];
    for (const [tabelle, label] of referenzen) {
      if (get(`SELECT id FROM ${tabelle} WHERE verantwortlich_kontakt_id = ? LIMIT 1`, k.id)) {
        throw new ApiError(400, `Kontakt ist als Verantwortlicher in ${label} hinterlegt und kann nicht gelöscht werden`);
      }
    }
    if (get('SELECT meeting_id FROM meeting_participants WHERE contact_id = ? LIMIT 1', k.id)) {
      throw new ApiError(400, 'Kontakt ist Besprechungsteilnehmer und kann nicht gelöscht werden');
    }
    require('../papierkorb').inPapierkorb(req, k.project_id, 'contacts', `Kontakt: ${k.name}`, { zeile: k });
    run('DELETE FROM contacts WHERE id = ?', k.id);
    audit(req, k.project_id, 'contact', k.id, 'geloescht', { name: k.name });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// CSV-Import mit Vorschau und Fehlerbericht (INT-01)
router.post('/projects/:projectId/contacts/import', requireProject('write'), (req, res, next) => {
  try {
    const { csv, commit } = req.body || {};
    if (!csv || !String(csv).trim()) throw new ApiError(400, 'CSV-Inhalt fehlt');
    const gueltigeGewerke = new Set(all('SELECT kuerzel FROM gewerke').map((g) => g.kuerzel));
    const zeilen = parseCsv(String(csv));
    const start = zeilen.length && /name/i.test(zeilen[0][0] || '') ? 1 : 0; // Kopfzeile überspringen
    const ok = [], fehler = [];
    zeilen.slice(start).forEach((z, i) => {
      const nr = start + i + 1;
      const [name, firma, rolle, gewerk, email, telefon] = z.map((f) => String(f || '').trim());
      if (!name) return fehler.push({ zeile: nr, grund: 'Name fehlt' });
      if (gewerk && !gueltigeGewerke.has(gewerk)) return fehler.push({ zeile: nr, grund: `Unbekanntes Gewerk-Kürzel '${gewerk}'` });
      ok.push({ name, firma, rolle, gewerk, email, telefon });
    });
    if (!commit) return res.json({ ok, fehler });
    for (const k of ok) {
      const r = run('INSERT INTO contacts (project_id, name, firma, rolle, gewerk, email, telefon) VALUES (?, ?, ?, ?, ?, ?, ?)',
        req.project.id, k.name, k.firma || null, k.rolle || null, k.gewerk || null, k.email || null, k.telefon || null);
      audit(req, req.project.id, 'contact', Number(r.lastInsertRowid), 'erstellt', { name: k.name, import: true });
    }
    res.json({ importiert: ok.length, fehler });
  } catch (e) { next(e); }
});

module.exports = router;
