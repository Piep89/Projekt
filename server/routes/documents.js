// M4 – Dokumentenregister: projektbezogene Master-Dokumentenliste (Bereiche A–F),
// Bewertung (benötigt/entfällt mit Begründungspflicht, DOK-01), Versionen als
// Datei-Upload ODER Ablageverweis (DOK-02, INT-06), Vollständigkeitsbericht (DOK-03),
// projektspezifische Zusatzeinträge (DOK-04), Einforderungs-Verantwortliche (DOK-05)
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const { get, all, run, tx, UPLOAD_DIR } = require('../db');
const { now, today, ApiError } = require('../util');
const { audit, diff } = require('../audit');
const { requireAuth, requireProject, canWriteGewerk } = require('../auth');
const { upload } = require('./core');

const router = express.Router();
router.use(requireAuth);

const BEREICHE = ['A', 'B', 'C', 'D', 'E', 'F'];
const BENOETIGT_WERTE = ['unbewertet', 'ja', 'nein', 'entfaellt'];
const STAND_WERTE = ['offen', 'erhalten', 'ueberfaellig'];
const DATUM_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------- Helfer ----------------
function pruefeDatum(wert, feldname) {
  if (wert === undefined || wert === null || String(wert).trim() === '') return null;
  const s = String(wert).trim();
  if (!DATUM_RE.test(s)) throw new ApiError(400, `${feldname} muss im Format JJJJ-MM-TT angegeben werden`);
  return s;
}

function pruefeGewerk(kuerzel) {
  if (kuerzel === undefined || kuerzel === null || String(kuerzel).trim() === '') return null;
  const k = String(kuerzel).trim();
  if (!get('SELECT id FROM gewerke WHERE kuerzel = ?', k)) throw new ApiError(400, `Unbekanntes Gewerk '${k}'`);
  return k;
}

function ladeEintrag(id) {
  const e = get('SELECT * FROM document_entries WHERE id = ?', Number(id));
  if (!e) throw new ApiError(404, 'Dokumenteintrag nicht gefunden');
  return e;
}

// Projekt-ID-Resolver für Objekt-Routen ohne projectId im Pfad
const eintragProjekt = (req) =>
  get('SELECT project_id FROM document_entries WHERE id = ?', Number(req.params.id))?.project_id ?? 0;

const versionProjekt = (req) =>
  get(`SELECT e.project_id FROM document_versions v
       JOIN document_entries e ON e.id = v.entry_id WHERE v.id = ?`,
    Number(req.params.id))?.project_id ?? 0;

// ---------------- Register eines Projekts (DOK-01) ----------------
// GET /api/projects/:projectId/documents?bereich=&gewerk=&benoetigt=&stand=&q=
router.get('/projects/:projectId/documents', requireProject('read'), (req, res, next) => {
  try {
    const { bereich, gewerk, benoetigt, stand, q } = req.query;
    const bedingungen = ['d.project_id = ?'];
    const parameter = [req.project.id];

    if (bereich) {
      if (!BEREICHE.includes(String(bereich))) throw new ApiError(400, 'Ungültiger Bereich (A–F)');
      bedingungen.push('d.bereich = ?');
      parameter.push(String(bereich));
    }
    if (gewerk) {
      bedingungen.push('d.gewerk = ?');
      parameter.push(String(gewerk));
    }
    if (benoetigt) {
      if (!BENOETIGT_WERTE.includes(String(benoetigt))) throw new ApiError(400, 'Ungültiger Benötigt-Filter');
      bedingungen.push('d.benoetigt = ?');
      parameter.push(String(benoetigt));
    }
    if (stand) {
      if (!STAND_WERTE.includes(String(stand))) throw new ApiError(400, 'Ungültiger Stand-Filter (offen/erhalten/ueberfaellig)');
      if (stand === 'offen') {
        bedingungen.push("d.benoetigt = 'ja' AND d.erhalten_am IS NULL");
      } else if (stand === 'erhalten') {
        bedingungen.push('d.erhalten_am IS NOT NULL');
      } else { // ueberfaellig
        bedingungen.push("d.benoetigt = 'ja' AND d.erhalten_am IS NULL AND d.faelligkeit IS NOT NULL AND d.faelligkeit < ?");
        parameter.push(today());
      }
    }
    if (q && String(q).trim()) {
      const like = `%${String(q).trim()}%`;
      bedingungen.push("(d.nr LIKE ? OR d.titel LIKE ? OR COALESCE(d.beschreibung, '') LIKE ?)");
      parameter.push(like, like, like);
    }

    const rows = all(
      `SELECT d.*, k.name AS verantwortlich_name,
              (SELECT COUNT(*) FROM document_versions v WHERE v.entry_id = d.id) AS version_anzahl
       FROM document_entries d
       LEFT JOIN contacts k ON k.id = d.verantwortlich_kontakt_id
       WHERE ${bedingungen.join(' AND ')}
       ORDER BY d.bereich, d.nr`, ...parameter);

    res.json(rows.map((d) => ({
      ...d,
      letzte_version: d.version_anzahl
        ? get(`SELECT id, version, datum, geliefert_von, link, attachment_id
               FROM document_versions WHERE entry_id = ? ORDER BY id DESC LIMIT 1`, d.id)
        : null,
    })));
  } catch (e) { next(e); }
});

// ---------------- Einzelner Eintrag mit Versionshistorie ----------------
router.get('/documents/:id', requireProject('read', eintragProjekt), (req, res, next) => {
  try {
    const e = ladeEintrag(req.params.id);
    const verantwortlich = e.verantwortlich_kontakt_id
      ? get('SELECT name FROM contacts WHERE id = ?', e.verantwortlich_kontakt_id)
      : null;
    const versionen = all(
      `SELECT v.*, u.display_name AS erstellt_von_name, a.filename AS datei_name
       FROM document_versions v
       LEFT JOIN users u ON u.id = v.created_by
       LEFT JOIN attachments a ON a.id = v.attachment_id
       WHERE v.entry_id = ? ORDER BY v.id`, e.id);
    res.json({ ...e, verantwortlich_name: verantwortlich ? verantwortlich.name : null, versionen });
  } catch (e) { next(e); }
});

// ---------------- Projektspezifischer Zusatzeintrag (DOK-04) ----------------
router.post('/projects/:projectId/documents', requireProject('write'), (req, res, next) => {
  try {
    const { bereich, titel, gewerk, beschreibung, faelligkeit, benoetigt } = req.body || {};
    if (!BEREICHE.includes(String(bereich || ''))) throw new ApiError(400, 'Bereich muss A–F sein');
    if (!titel || !String(titel).trim()) throw new ApiError(400, 'Titel ist Pflicht');
    const gewerkWert = pruefeGewerk(gewerk);
    const faelligkeitWert = pruefeDatum(faelligkeit, 'Fälligkeit');
    const benoetigtWert = benoetigt === undefined || benoetigt === null || benoetigt === '' ? 'ja' : String(benoetigt);
    if (!['ja', 'unbewertet'].includes(benoetigtWert)) throw new ApiError(400, "Zusatzeinträge starten mit benoetigt 'ja' oder 'unbewertet'");
    if (!canWriteGewerk(req.access, gewerkWert || '')) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');

    const { id, nr } = tx(() => {
      // Fortlaufende Zusatz-Nummer je Bereich: '<bereich>.Z<lfd>'
      let max = 0;
      for (const row of all('SELECT nr FROM document_entries WHERE project_id = ? AND bereich = ? AND nr LIKE ?',
        req.project.id, String(bereich), `${bereich}.Z%`)) {
        const m = /\.Z(\d+)$/.exec(row.nr);
        if (m) max = Math.max(max, Number(m[1]));
      }
      const nummer = `${bereich}.Z${max + 1}`;
      const r = run(
        `INSERT INTO document_entries (project_id, bereich, nr, titel, gewerk, beschreibung, benoetigt, faelligkeit, is_custom)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        req.project.id, String(bereich), nummer, String(titel).trim(), gewerkWert,
        beschreibung ? String(beschreibung) : null, benoetigtWert, faelligkeitWert);
      return { id: Number(r.lastInsertRowid), nr: nummer };
    });

    audit(req, req.project.id, 'document', id, 'erstellt',
      { nr, titel: String(titel).trim(), bereich: String(bereich), zusatz: true });
    res.status(201).json({ id, nr });
  } catch (e) { next(e); }
});

// ---------------- Eintrag bewerten/ändern (DOK-01/DOK-05) ----------------
router.patch('/documents/:id', requireProject('write', eintragProjekt), (req, res, next) => {
  try {
    const e = ladeEintrag(req.params.id);
    const b = req.body || {};
    if (!canWriteGewerk(req.access, e.gewerk || '')) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');

    // Titel/Beschreibung/Gewerk sind nur bei projektspezifischen Zusatzeinträgen änderbar
    if (!e.is_custom && (b.titel !== undefined || b.beschreibung !== undefined || b.gewerk !== undefined)) {
      throw new ApiError(400, 'Titel, Beschreibung und Gewerk sind nur bei projektspezifischen Zusatzeinträgen änderbar');
    }

    const neu = {
      benoetigt: b.benoetigt === undefined ? e.benoetigt : String(b.benoetigt),
      begruendung: b.begruendung === undefined ? e.begruendung : (b.begruendung === null ? null : String(b.begruendung).trim() || null),
      faelligkeit: b.faelligkeit === undefined ? e.faelligkeit : pruefeDatum(b.faelligkeit, 'Fälligkeit'),
      verantwortlich_kontakt_id: e.verantwortlich_kontakt_id,
      titel: e.titel,
      beschreibung: e.beschreibung,
      gewerk: e.gewerk,
    };

    if (!BENOETIGT_WERTE.includes(neu.benoetigt)) {
      throw new ApiError(400, "Benötigt muss 'ja', 'nein', 'entfaellt' oder 'unbewertet' sein");
    }
    // Harte Begründungspflicht bei 'entfaellt' (DOK-01)
    if (neu.benoetigt === 'entfaellt' && !String(neu.begruendung || '').trim()) {
      throw new ApiError(400, 'Begründung ist bei "Entfällt" Pflicht');
    }

    if (b.verantwortlich_kontakt_id !== undefined) {
      if (b.verantwortlich_kontakt_id === null || b.verantwortlich_kontakt_id === '') {
        neu.verantwortlich_kontakt_id = null;
      } else {
        const kid = Number(b.verantwortlich_kontakt_id);
        if (!Number.isInteger(kid) || kid <= 0) throw new ApiError(400, 'Ungültige Kontakt-ID');
        if (!get('SELECT id FROM contacts WHERE id = ? AND project_id = ?', kid, e.project_id)) {
          throw new ApiError(404, 'Kontakt nicht gefunden (muss zum Projekt gehören)');
        }
        neu.verantwortlich_kontakt_id = kid;
      }
    }

    if (e.is_custom) {
      if (b.titel !== undefined) {
        if (!String(b.titel).trim()) throw new ApiError(400, 'Titel darf nicht leer sein');
        neu.titel = String(b.titel).trim();
      }
      if (b.beschreibung !== undefined) neu.beschreibung = b.beschreibung === null ? null : String(b.beschreibung);
      if (b.gewerk !== undefined) {
        neu.gewerk = pruefeGewerk(b.gewerk);
        if (!canWriteGewerk(req.access, neu.gewerk || '')) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');
      }
    }

    run(`UPDATE document_entries SET benoetigt = ?, begruendung = ?, faelligkeit = ?,
         verantwortlich_kontakt_id = ?, titel = ?, beschreibung = ?, gewerk = ? WHERE id = ?`,
      neu.benoetigt, neu.begruendung, neu.faelligkeit, neu.verantwortlich_kontakt_id,
      neu.titel, neu.beschreibung, neu.gewerk, e.id);

    const aenderungen = diff(e, neu,
      ['benoetigt', 'begruendung', 'faelligkeit', 'verantwortlich_kontakt_id', 'titel', 'beschreibung', 'gewerk']);
    if (Object.keys(aenderungen).length) audit(req, e.project_id, 'document', e.id, 'geaendert', aenderungen);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- Neue Version: Datei-Upload ODER Ablageverweis (DOK-02) ----------------
router.post('/documents/:id/versions', requireProject('write', eintragProjekt), upload.single('datei'), (req, res, next) => {
  try {
    const e = ladeEintrag(req.params.id);
    if (!canWriteGewerk(req.access, e.gewerk || '')) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');
    const b = req.body || {};

    const link = b.link !== undefined && b.link !== null ? String(b.link).trim() : '';
    if (!req.file && !link) throw new ApiError(400, 'Datei-Upload oder Ablageverweis (link) ist erforderlich');
    if (req.file && link) throw new ApiError(400, 'Entweder Datei-Upload oder Ablageverweis angeben, nicht beides');

    const anzahl = get('SELECT COUNT(*) AS n FROM document_versions WHERE entry_id = ?', e.id).n;
    const version = b.version !== undefined && String(b.version).trim() ? String(b.version).trim() : String(anzahl + 1);
    const datum = pruefeDatum(b.datum, 'Datum') || today();
    const geliefertVon = b.geliefert_von !== undefined && String(b.geliefert_von).trim() ? String(b.geliefert_von).trim() : null;
    const kommentar = b.kommentar !== undefined && String(b.kommentar).trim() ? String(b.kommentar).trim() : null;

    const ergebnis = tx(() => {
      let attachmentId = null;
      if (req.file) {
        const ar = run(
          `INSERT INTO attachments (object_typ, object_id, filename, path, mime, size, uploaded_by, created_at)
           VALUES ('document', ?, ?, ?, ?, ?, ?, ?)`,
          e.id, req.file.originalname, path.basename(req.file.path),
          req.file.mimetype, req.file.size, req.user.id, now());
        attachmentId = Number(ar.lastInsertRowid);
      }
      const vr = run(
        `INSERT INTO document_versions (entry_id, version, datum, geliefert_von, attachment_id, link, kommentar, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.id, version, datum, geliefertVon, attachmentId, link || null, kommentar, req.user.id, now());
      // Erhalten setzen (falls leer) und 'unbewertet' automatisch auf 'ja' heben
      run(`UPDATE document_entries SET erhalten_am = COALESCE(erhalten_am, ?),
           benoetigt = CASE WHEN benoetigt = 'unbewertet' THEN 'ja' ELSE benoetigt END WHERE id = ?`,
        datum, e.id);
      return { id: Number(vr.lastInsertRowid), attachment_id: attachmentId };
    });

    audit(req, e.project_id, 'document', e.id, 'version', {
      version, datum,
      ...(req.file ? { datei: req.file.originalname } : { link }),
      ...(geliefertVon ? { geliefert_von: geliefertVon } : {}),
    });
    res.status(201).json(ergebnis);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    next(err);
  }
});

// ---------------- Version löschen (nur Projektleiter) ----------------
router.delete('/document-versions/:id', requireProject('write', versionProjekt), (req, res, next) => {
  try {
    if (req.access.memberRole !== 'projektleiter') {
      throw new ApiError(403, 'Nur Projektleiter dürfen Dokumentversionen löschen');
    }
    const v = get('SELECT * FROM document_versions WHERE id = ?', Number(req.params.id));
    if (!v) throw new ApiError(404, 'Version nicht gefunden');
    const e = ladeEintrag(v.entry_id);

    let dateiPfad = null;
    tx(() => {
      run('DELETE FROM document_versions WHERE id = ?', v.id);
      if (v.attachment_id) {
        const a = get('SELECT * FROM attachments WHERE id = ?', v.attachment_id);
        if (a) {
          run('DELETE FROM attachments WHERE id = ?', a.id);
          dateiPfad = path.join(UPLOAD_DIR, a.path);
        }
      }
      const rest = get('SELECT COUNT(*) AS n FROM document_versions WHERE entry_id = ?', e.id).n;
      if (rest === 0) run('UPDATE document_entries SET erhalten_am = NULL WHERE id = ?', e.id);
    });
    if (dateiPfad) fs.unlink(dateiPfad, () => {});

    audit(req, e.project_id, 'document', e.id, 'version_geloescht', { version: v.version, datum: v.datum });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- Vollständigkeitsbericht (DOK-03) ----------------
router.get('/projects/:projectId/documents/vollstaendigkeit', requireProject('read'), (req, res, next) => {
  try {
    const t = today();
    const fehlend = all(
      `SELECT d.id, d.bereich, d.nr, d.titel, d.gewerk, d.faelligkeit, k.name AS verantwortlich_name
       FROM document_entries d
       LEFT JOIN contacts k ON k.id = d.verantwortlich_kontakt_id
       WHERE d.project_id = ? AND d.benoetigt = 'ja' AND d.erhalten_am IS NULL
       ORDER BY d.bereich, d.nr`, req.project.id)
      .map((r) => ({ ...r, ueberfaellig: Boolean(r.faelligkeit && r.faelligkeit < t) }));

    const nachBereich = {};
    for (const b of BEREICHE) nachBereich[b] = { benoetigt: 0, erhalten: 0, fehlend: 0 };
    for (const row of all(
      `SELECT bereich,
              SUM(CASE WHEN benoetigt = 'ja' THEN 1 ELSE 0 END) AS benoetigt,
              SUM(CASE WHEN benoetigt = 'ja' AND erhalten_am IS NOT NULL THEN 1 ELSE 0 END) AS erhalten
       FROM document_entries WHERE project_id = ? GROUP BY bereich`, req.project.id)) {
      nachBereich[row.bereich] = {
        benoetigt: row.benoetigt || 0,
        erhalten: row.erhalten || 0,
        fehlend: (row.benoetigt || 0) - (row.erhalten || 0),
      };
    }

    const unbewertet = get(
      "SELECT COUNT(*) AS n FROM document_entries WHERE project_id = ? AND benoetigt = 'unbewertet'",
      req.project.id).n;

    res.json({ fehlend, nach_bereich: nachBereich, unbewertet });
  } catch (e) { next(e); }
});

module.exports = router;
