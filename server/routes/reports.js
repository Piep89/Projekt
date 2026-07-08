// M8 – Berichte, Exporte und Suche (REP-01 … REP-04) + Protokoll-/Raumbuch-/Mängel-/Journal-PDFs
const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const archiver = require('archiver');
const { get, all } = require('../db');
const { UPLOAD_DIR } = require('../db');
const { now, ApiError, toCsv, csvList } = require('../util');
const { audit } = require('../audit');
const { requireAuth, requireProject } = require('../auth');
const { pdfResponse, pdfBuffer } = require('../pdf/helpers');
const B = require('../pdf/builders');

const router = express.Router();
router.use(requireAuth);

const meetingProjekt = (req) => get('SELECT project_id FROM meetings WHERE id = ?', Number(req.params.meetingId))?.project_id ?? 0;

function csvResponse(res, dateiname, inhalt) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(dateiname)}"`);
  res.send(inhalt);
}

// ---------------- REP-01: Statusbericht ----------------
router.get('/projects/:projectId/reports/statusbericht.pdf', requireProject('read'), (req, res) => {
  audit(req, req.project.id, 'project', req.project.id, 'export', { bericht: 'statusbericht' });
  pdfResponse(res, `Statusbericht_${req.project.name}.pdf`, (doc) => B.statusbericht(doc, req.project.id));
});

// ---------------- REP-02: Gewerke-Auszug ----------------
router.get('/projects/:projectId/reports/gewerk/:kuerzel.pdf', requireProject('read'), (req, res, next) => {
  const kuerzel = req.params.kuerzel;
  if (!get('SELECT id FROM gewerke WHERE kuerzel = ?', kuerzel)) return next(new ApiError(404, 'Gewerk nicht gefunden'));
  pdfResponse(res, `Gewerkeauszug_${kuerzel}.pdf`, (doc) => B.gewerkAuszug(doc, req.project.id, kuerzel));
});

router.get('/projects/:projectId/reports/gewerk/:kuerzel.csv', requireProject('read'), (req, res, next) => {
  const kuerzel = req.params.kuerzel;
  if (!get('SELECT id FROM gewerke WHERE kuerzel = ?', kuerzel)) return next(new ApiError(404, 'Gewerk nicht gefunden'));
  const daten = B.gewerkDaten(req.project.id, kuerzel);
  const teile = [
    `Offene Checkpunkte (${kuerzel})`,
    toCsv(daten.punkte, [
      { label: 'Nr', value: 'nr' }, { label: 'Punkt', value: 'text' }, { label: 'Status', value: 'status' },
      { label: 'Verantwortlich', value: 'verantwortlich_name' }, { label: 'Termin', value: 'termin' },
    ]),
    '', `Raumbuch-Attribute (${kuerzel})`,
    toCsv(daten.attribute, [
      { label: 'Raum', value: (r) => `${r.raum_nummer} ${r.raum_bezeichnung}` }, { label: 'Attribut', value: 'name' },
      { label: 'Soll', value: 'soll' }, { label: 'Ist', value: 'ist' }, { label: 'Status', value: 'status' }, { label: 'Quelle', value: 'quelle' },
    ]),
    '', `Offene Protokollpunkte (${kuerzel})`,
    toCsv(daten.protokollpunkte, [
      { label: 'Code', value: 'code' }, { label: 'Punkt', value: 'text' },
      { label: 'Verantwortlich', value: 'verantwortlich_name' }, { label: 'Termin', value: 'termin' },
    ]),
  ];
  csvResponse(res, `Gewerkeauszug_${kuerzel}.csv`, teile.join('\r\n'));
});

// ---------------- RB-06/08: Raumbuch-Exporte ----------------
router.get('/projects/:projectId/raumbuch.pdf', requireProject('read'), (req, res, next) => {
  const planstand = req.query.planstand ? Number(req.query.planstand) : null;
  if (planstand && !get('SELECT id FROM plan_states WHERE id = ? AND project_id = ?', planstand, req.project.id)) {
    return next(new ApiError(404, 'Planstand nicht gefunden'));
  }
  pdfResponse(res, `Raumbuch_${req.project.name}.pdf`, (doc) => B.raumbuch(doc, req.project.id, planstand));
});

function raumbuchFlach(projectId, planstandId) {
  const daten = B.raumbuchDaten(projectId, planstandId);
  const zeilen = [];
  for (const raum of daten.rooms) {
    if (!(raum.attribute || []).length) zeilen.push({ raum: raum.nummer, bezeichnung: raum.bezeichnung, gewerk: '', name: '', soll: '', ist: '', status: '', quelle: '' });
    for (const a of raum.attribute || []) {
      zeilen.push({ raum: raum.nummer, bezeichnung: raum.bezeichnung, gewerk: a.gewerk, name: a.name + (a.einheit ? ` [${a.einheit}]` : ''), soll: a.soll, ist: a.ist, status: a.status, quelle: a.quelle });
    }
  }
  return { daten, zeilen };
}

router.get('/projects/:projectId/raumbuch.csv', requireProject('read'), (req, res, next) => {
  const planstand = req.query.planstand ? Number(req.query.planstand) : null;
  if (planstand && !get('SELECT id FROM plan_states WHERE id = ? AND project_id = ?', planstand, req.project.id)) {
    return next(new ApiError(404, 'Planstand nicht gefunden'));
  }
  const { zeilen } = raumbuchFlach(req.project.id, planstand);
  csvResponse(res, `Raumbuch_${req.project.name}.csv`, toCsv(zeilen, [
    { label: 'Raum', value: 'raum' }, { label: 'Bezeichnung', value: 'bezeichnung' }, { label: 'Gewerk', value: 'gewerk' },
    { label: 'Attribut', value: 'name' }, { label: 'Soll', value: 'soll' }, { label: 'Ist', value: 'ist' },
    { label: 'Status', value: 'status' }, { label: 'Quelle', value: 'quelle' },
  ]));
});

// Word-Export (INT-02): HTML-basierte .doc-Datei, öffnet in Microsoft Word
router.get('/projects/:projectId/raumbuch.doc', requireProject('read'), (req, res, next) => {
  const planstand = req.query.planstand ? Number(req.query.planstand) : null;
  if (planstand && !get('SELECT id FROM plan_states WHERE id = ? AND project_id = ?', planstand, req.project.id)) {
    return next(new ApiError(404, 'Planstand nicht gefunden'));
  }
  const { daten } = raumbuchFlach(req.project.id, planstand);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const kopfInfo = daten.planstand
    ? `Planstand: ${esc(daten.planstand.name)} (${esc(daten.planstand.typ)}) · ${esc(daten.planstand.datum)}${daten.planstand.freigabe_vermerk ? ' · Freigabe: ' + esc(daten.planstand.freigabe_vermerk) : ''}`
    : 'Arbeitsstand (nicht eingefroren)';
  let html = `<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Raumbuch</title>
<style>body{font-family:Arial,sans-serif;font-size:10pt}h1{color:#1f4e79}h2{color:#1f4e79;font-size:13pt;margin-top:18pt}h3{font-size:11pt;margin:8pt 0 2pt}table{border-collapse:collapse;width:100%}td,th{border:1pt solid #999;padding:3pt;text-align:left;font-size:9pt}th{background:#eef2f7}</style></head><body>
<p style="color:#666;font-size:8pt">GGP – Großgeräte-Projektabwicklung</p>
<h1>Raumbuch – ${esc(req.project.name)}</h1><p>${kopfInfo} · Erstellt am ${new Date().toLocaleDateString('de-DE')}</p>`;
  for (const raum of daten.rooms) {
    html += `<h2>Raum ${esc(raum.nummer)} – ${esc(raum.bezeichnung)}</h2><p>${[
      raum.funktion && `Funktion: ${esc(raum.funktion)}`, raum.flaeche_m2 && `Fläche: ${esc(raum.flaeche_m2)} m²`,
      raum.hoehe_m && `Höhe: ${esc(raum.hoehe_m)} m`, raum.raumgruppe && `Raumgruppe: ${esc(raum.raumgruppe)}`,
      raum.strahlenschutz && `Strahlenschutz: ${esc(raum.strahlenschutz)}`, raum.hf_anforderung && `HF: ${esc(raum.hf_anforderung)}`,
    ].filter(Boolean).join(' · ')}</p>`;
    const jeGewerk = {};
    for (const a of raum.attribute || []) (jeGewerk[a.gewerk] = jeGewerk[a.gewerk] || []).push(a);
    for (const [gewerk, attrs] of Object.entries(jeGewerk)) {
      html += `<h3>${esc(gewerk)}</h3><table><tr><th>Attribut</th><th>Soll</th><th>Ist</th><th>Status</th><th>Quelle/Kommentar</th></tr>`;
      for (const a of attrs) {
        html += `<tr><td>${esc(a.name)}${a.einheit ? ` [${esc(a.einheit)}]` : ''}</td><td>${esc(a.soll)}</td><td>${esc(a.ist)}</td><td>${esc(a.status)}</td><td>${esc(a.quelle)}</td></tr>`;
      }
      html += '</table>';
    }
  }
  html += '</body></html>';
  res.setHeader('Content-Type', 'application/msword');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent('Raumbuch_' + req.project.name + '.doc')}"`);
  res.send(html);
});

// ---------------- PRO-05: Protokoll-PDF ----------------
router.get('/meetings/:meetingId/protokoll.pdf', requireProject('read', meetingProjekt), (req, res) => {
  pdfResponse(res, `Protokoll_${req.params.meetingId}.pdf`, (doc) => B.protokoll(doc, Number(req.params.meetingId)));
});

// ---------------- MGL-02: Mängelliste ----------------
router.get('/projects/:projectId/maengelliste.pdf', requireProject('read'), (req, res) => {
  const { gewerk, firma, status } = req.query;
  pdfResponse(res, `Maengelliste_${req.project.name}.pdf`, (doc) => B.maengelliste(doc, req.project.id, { gewerk, firma, status }));
});

// ---------------- NOT-05: Bautagebuch ----------------
router.get('/projects/:projectId/journal.pdf', requireProject('read'), (req, res) => {
  const { von, bis } = req.query;
  pdfResponse(res, `Bautagebuch_${req.project.name}.pdf`, (doc) => B.journal(doc, req.project.id, von || null, bis || null));
});

// ---------------- Zeitraum-/Wochenbericht ----------------
router.get('/projects/:projectId/reports/zeitraum.pdf', requireProject('read'), (req, res, next) => {
  const { von, bis } = req.query;
  const istDatum = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  if (!istDatum(von) || !istDatum(bis)) return next(new ApiError(400, 'von und bis (JJJJ-MM-TT) sind Pflicht'));
  pdfResponse(res, `Zeitraumbericht_${req.project.name}_${von}_${bis}.pdf`,
    (doc) => B.zeitraumbericht(doc, req.project.id, von, bis));
});

// ---------------- DOK-03: Vollständigkeitsbericht ----------------
router.get('/projects/:projectId/reports/vollstaendigkeit.pdf', requireProject('read'), (req, res) => {
  pdfResponse(res, `Vollstaendigkeit_${req.project.name}.pdf`, (doc) => B.vollstaendigkeit(doc, req.project.id));
});

// ---------------- REP-03: Vollexport der Projektakte (ZIP) ----------------
router.get('/projects/:projectId/export', requireProject('read'), async (req, res, next) => {
  try {
    const pid = req.project.id;
    const fehlerliste = [];
    audit(req, pid, 'project', pid, 'export', { art: 'vollexport' }); // SEC-03

    const archiv = archiver('zip', { zlib: { level: 6 } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent('Projektakte_' + req.project.name + '.zip')}"`);
    archiv.on('error', (e) => next(e));
    archiv.pipe(res);

    const json = (name, daten) => archiv.append(JSON.stringify(daten, null, 2), { name: `daten/${name}.json` });

    // --- Strukturierte Daten (private Notizen sind bewusst AUSGESCHLOSSEN, ROL-05) ---
    json('projekt', {
      ...req.project,
      mitglieder: all('SELECT m.user_id, m.role, m.gewerke, u.username, u.display_name FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = ?', pid),
      meilensteine: all('SELECT * FROM milestones WHERE project_id = ? ORDER BY sort_order', pid),
      vorlage: req.project.template_id ? get('SELECT id, version, name FROM templates WHERE id = ?', req.project.template_id) : null,
    });

    const checkpunkte = all(
      `SELECT c.*, ph.name AS phase_name, k.name AS verantwortlich_name FROM checkpoints c
       JOIN phases ph ON ph.id = c.phase_id LEFT JOIN contacts k ON k.id = c.verantwortlich_kontakt_id
       WHERE c.project_id = ? ORDER BY ph.sort_order, c.nr`, pid).map((c) => ({
      ...c,
      kommentare: all("SELECT c2.text, c2.created_at, u.display_name AS von FROM comments c2 LEFT JOIN users u ON u.id = c2.user_id WHERE c2.object_typ = 'checkpoint' AND c2.object_id = ? ORDER BY c2.created_at", c.id),
      verknuepfungen: all("SELECT from_typ, from_id, to_typ, to_id FROM links WHERE (from_typ = 'checkpoint' AND from_id = ?) OR (to_typ = 'checkpoint' AND to_id = ?)", c.id, c.id),
      verlauf: all("SELECT action, details, username, timestamp FROM audit_trail WHERE object_typ = 'checkpoint' AND object_id = ? ORDER BY timestamp", c.id),
    }));
    json('checkpunkte', checkpunkte);

    json('raumbuch', all('SELECT * FROM rooms WHERE project_id = ? ORDER BY nummer', pid).map((r) => ({
      ...r, attribute: all('SELECT * FROM room_attributes WHERE room_id = ? ORDER BY gewerk, sort_order', r.id),
    })));
    json('planstaende', all('SELECT id, name, typ, datum, freigabe_vermerk, created_at FROM plan_states WHERE project_id = ?', pid));
    json('dokumente', all('SELECT * FROM document_entries WHERE project_id = ? ORDER BY bereich, nr', pid).map((d) => ({
      ...d, versionen: all('SELECT * FROM document_versions WHERE entry_id = ? ORDER BY created_at', d.id),
    })));
    const besprechungen = all('SELECT * FROM meetings WHERE project_id = ? ORDER BY datum', pid).map((m) => ({
      ...m,
      teilnehmer: all('SELECT mp.status, k.name, k.firma FROM meeting_participants mp JOIN contacts k ON k.id = mp.contact_id WHERE mp.meeting_id = ?', m.id),
      punkte: all('SELECT * FROM protocol_items WHERE meeting_id = ? ORDER BY nummer', m.id),
    }));
    json('besprechungen', besprechungen);
    json('aufgaben', all('SELECT * FROM tasks WHERE project_id = ?', pid));
    json('journal', all('SELECT j.*, u.display_name AS verfasser FROM journal_entries j LEFT JOIN users u ON u.id = j.verfasser_id WHERE j.project_id = ? ORDER BY j.datum', pid).map((j) => ({
      ...j, fotos: all('SELECT id, filename, beschreibung, aufnahme_zeit FROM photos WHERE journal_id = ?', j.id),
    })));
    json('maengel', all('SELECT * FROM defects WHERE project_id = ? ORDER BY nummer', pid));
    json('kontakte', all('SELECT * FROM contacts WHERE project_id = ? ORDER BY name', pid));
    json('audit', all('SELECT object_typ, object_id, action, details, username, timestamp FROM audit_trail WHERE project_id = ? ORDER BY timestamp', pid));

    // --- CSV-Auszüge ---
    archiv.append(toCsv(checkpunkte, [
      { label: 'Nr', value: 'nr' }, { label: 'Phase', value: 'phase_name' }, { label: 'Punkt', value: 'text' },
      { label: 'Gewerke', value: 'gewerke' }, { label: 'Relevanz', value: 'relevanz' }, { label: 'Begruendung', value: 'relevanz_begruendung' },
      { label: 'Status', value: 'status' }, { label: 'Verantwortlich', value: 'verantwortlich_name' }, { label: 'Termin', value: 'termin' },
    ]), { name: 'daten/checkpunkte.csv' });
    const { zeilen: rbZeilen } = raumbuchFlach(pid, null);
    archiv.append(toCsv(rbZeilen, [
      { label: 'Raum', value: 'raum' }, { label: 'Bezeichnung', value: 'bezeichnung' }, { label: 'Gewerk', value: 'gewerk' },
      { label: 'Attribut', value: 'name' }, { label: 'Soll', value: 'soll' }, { label: 'Ist', value: 'ist' }, { label: 'Status', value: 'status' },
    ]), { name: 'daten/raumbuch.csv' });
    archiv.append(toCsv(all('SELECT * FROM document_entries WHERE project_id = ? ORDER BY bereich, nr', pid), [
      { label: 'Nr', value: 'nr' }, { label: 'Titel', value: 'titel' }, { label: 'Gewerk', value: 'gewerk' },
      { label: 'Benoetigt', value: 'benoetigt' }, { label: 'Erhalten am', value: 'erhalten_am' }, { label: 'Faelligkeit', value: 'faelligkeit' },
    ]), { name: 'daten/dokumente.csv' });
    archiv.append(toCsv(all('SELECT * FROM defects WHERE project_id = ? ORDER BY nummer', pid), [
      { label: 'Nr', value: (d) => `M-${String(d.nummer).padStart(3, '0')}` }, { label: 'Beschreibung', value: 'beschreibung' },
      { label: 'Gewerk', value: 'gewerk' }, { label: 'Firma', value: 'firma' }, { label: 'Frist', value: 'frist' }, { label: 'Status', value: 'status' },
    ]), { name: 'daten/maengel.csv' });

    // --- Dateien: Anhänge (nur Objekte dieses Projekts) und Fotos ---
    const objektTabellen = {
      checkpoint: 'checkpoints', room: 'rooms', document: 'document_entries', meeting: 'meetings',
      protocol_item: 'protocol_items', task: 'tasks', defect: 'defects', journal: 'journal_entries', contact: 'contacts',
    };
    for (const a of all('SELECT * FROM attachments')) {
      const tabelle = objektTabellen[a.object_typ];
      if (!tabelle) continue;
      const obj = get(`SELECT project_id FROM ${tabelle} WHERE id = ?`, a.object_id);
      if (!obj || obj.project_id !== pid) continue;
      const datei = path.join(UPLOAD_DIR, a.path);
      if (fs.existsSync(datei)) archiv.file(datei, { name: `dateien/anhaenge/${a.id}_${a.filename}` });
      else fehlerliste.push(`Anhang fehlt auf Datenträger: ${a.filename}`);
    }
    for (const foto of all('SELECT * FROM photos WHERE project_id = ?', pid)) {
      const datei = path.join(UPLOAD_DIR, foto.path);
      if (fs.existsSync(datei)) archiv.file(datei, { name: `dateien/fotos/${foto.id}_${foto.filename}` });
      else fehlerliste.push(`Foto fehlt auf Datenträger: ${foto.filename}`);
    }

    // --- PDF-Sammelmappe ---
    const pdfSicher = async (name, buildFn) => {
      try { archiv.append(await pdfBuffer(buildFn), { name: `pdf/${name}` }); }
      catch (e) { fehlerliste.push(`PDF ${name}: ${e.message}`); }
    };
    await pdfSicher('statusbericht.pdf', (doc) => B.statusbericht(doc, pid));
    await pdfSicher('raumbuch.pdf', (doc) => B.raumbuch(doc, pid, null));
    await pdfSicher('bautagebuch.pdf', (doc) => B.journal(doc, pid, null, null));
    await pdfSicher('maengelliste.pdf', (doc) => B.maengelliste(doc, pid, {}));
    await pdfSicher('dokumente-vollstaendigkeit.pdf', (doc) => B.vollstaendigkeit(doc, pid));
    for (const m of besprechungen) {
      await pdfSicher(`protokolle/protokoll_${String(m.id).padStart(3, '0')}_${m.datum}.pdf`, (doc) => B.protokoll(doc, m.id));
    }

    const vorlage = req.project.template_id ? get('SELECT version, name FROM templates WHERE id = ?', req.project.template_id) : null;
    archiv.append([
      `GGP – Vollexport der Projektakte`,
      `Projekt: ${req.project.name} (#${pid})`,
      `Exportiert am: ${now()} durch ${req.user.display_name} (${req.user.username})`,
      `Vorlage: ${vorlage ? `${vorlage.name} (Version ${vorlage.version})` : '—'}`,
      ``,
      `Struktur:`,
      `  daten/    – alle Fachdaten als JSON (vollständig) und CSV (Auszüge)`,
      `  dateien/  – hochgeladene Anhänge und Fotos`,
      `  pdf/      – generierte PDF-Sammelmappe (Statusbericht, Raumbuch, Protokolle, Bautagebuch, Mängelliste)`,
      ``,
      `Private Notizen sind gemäß ROL-05 nicht Bestandteil des Exports.`,
      fehlerliste.length ? `\nWarnungen:\n${fehlerliste.map((f) => '  - ' + f).join('\n')}` : `\nKeine Warnungen.`,
    ].join('\n'), { name: 'LIESMICH.txt' });

    await archiv.finalize();
  } catch (e) { next(e); }
});

// ---------------- REP-04: Volltextsuche ----------------
router.get('/search', (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) throw new ApiError(400, 'Suchbegriff muss mindestens 2 Zeichen haben');
    const like = `%${q}%`;
    const projektFilter = req.query.projekt ? Number(req.query.projekt) : null;

    let projekte = req.user.role === 'admin'
      ? all('SELECT id, name FROM projects')
      : all('SELECT p.id, p.name FROM projects p JOIN project_members m ON m.project_id = p.id AND m.user_id = ?', req.user.id);
    if (projektFilter) projekte = projekte.filter((p) => p.id === projektFilter);
    if (!projekte.length) return res.json({});
    const ids = projekte.map((p) => p.id);
    const namen = Object.fromEntries(projekte.map((p) => [p.id, p.name]));
    const inIds = ids.map(() => '?').join(',');
    const mitProjekt = (rows) => rows.map((r) => ({ ...r, projekt_name: namen[r.project_id] }));

    res.json({
      checkpoints: mitProjekt(all(`SELECT id, project_id, nr, text, status FROM checkpoints WHERE project_id IN (${inIds}) AND (nr LIKE ? OR text LIKE ? OR hinweis LIKE ?) ORDER BY nr LIMIT 25`, ...ids, like, like, like)),
      protocol_items: mitProjekt(all(`SELECT id, project_id, meeting_id, code, text, status FROM protocol_items WHERE project_id IN (${inIds}) AND (code LIKE ? OR text LIKE ?) LIMIT 25`, ...ids, like, like)),
      journal: mitProjekt(all(`SELECT id, project_id, datum, substr(text, 1, 200) AS text FROM journal_entries WHERE project_id IN (${inIds}) AND text LIKE ? ORDER BY datum DESC LIMIT 25`, ...ids, like)),
      rooms: mitProjekt(all(`SELECT id, project_id, nummer, bezeichnung, funktion FROM rooms WHERE project_id IN (${inIds}) AND (nummer LIKE ? OR bezeichnung LIKE ? OR funktion LIKE ?) LIMIT 25`, ...ids, like, like, like)),
      documents: mitProjekt(all(`SELECT id, project_id, nr, titel, benoetigt FROM document_entries WHERE project_id IN (${inIds}) AND (nr LIKE ? OR titel LIKE ? OR beschreibung LIKE ?) LIMIT 25`, ...ids, like, like, like)),
      contacts: mitProjekt(all(`SELECT id, project_id, name, firma, rolle FROM contacts WHERE project_id IN (${inIds}) AND (name LIKE ? OR firma LIKE ? OR rolle LIKE ?) LIMIT 25`, ...ids, like, like, like)),
      tasks: mitProjekt(all(`SELECT id, project_id, titel, status, termin FROM tasks WHERE project_id IN (${inIds}) AND (titel LIKE ? OR beschreibung LIKE ?) LIMIT 25`, ...ids, like, like)),
      defects: mitProjekt(all(`SELECT id, project_id, nummer, beschreibung, status FROM defects WHERE project_id IN (${inIds}) AND (beschreibung LIKE ? OR firma LIKE ?) LIMIT 25`, ...ids, like, like)),
      meetings: mitProjekt(all(`SELECT id, project_id, titel, datum, status FROM meetings WHERE project_id IN (${inIds}) AND titel LIKE ? ORDER BY datum DESC LIMIT 25`, ...ids, like)),
      // Private Notizen bewusst NICHT hier (ROL-05) – die eigene Notizsuche läuft über /api/notes?q=
    });
  } catch (e) { next(e); }
});

module.exports = router;
