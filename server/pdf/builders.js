// Berichts-Builder: je Funktion ein vollständiges PDF (schreibt in ein übergebenes pdfkit-Dokument)
const path = require('node:path');
const { get, all } = require('../db');
const { today, csvList } = require('../util');
const { UPLOAD_DIR } = require('../db');
const H = require('./helpers');

const dat = (iso) => iso ? new Date(String(iso).length <= 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('de-DE') : '—';
const LABELS = {
  offen: 'Offen', in_bearbeitung: 'In Bearbeitung', erledigt: 'Erledigt', blockiert: 'Blockiert',
  nicht_relevant: 'Nicht relevant', unbewertet: 'Unbewertet', relevant: 'Relevant',
  festgelegt: 'Festgelegt', bestaetigt: 'Bestätigt', abweichend: 'Abweichend',
  information: 'Information', beschluss: 'Beschluss', aufgabe: 'Aufgabe',
  in_behebung: 'In Behebung', behoben: 'Behoben', abgenommen: 'Abgenommen',
  geplant: 'Geplant', entwurf: 'Entwurf', versandt: 'Versandt', festgestellt: 'Festgestellt',
  eingeladen: 'Eingeladen', anwesend: 'Anwesend', entschuldigt: 'Entschuldigt', verteiler: 'Verteiler',
  vorplanung: 'Vorplanung', ausfuehrung: 'Ausführung', as_built: 'As built', sonstig: 'Sonstig',
  baustelle: 'Baustelle', planung: 'Planung', telefonat: 'Telefonat', begehung: 'Begehung',
  bau: 'Baubesprechung', lenkung: 'Lenkungskreis', sonstige: 'Sonstige',
};
const lbl = (v) => LABELS[v] || v || '—';

// ============ REP-01: Statusbericht ============
function statusbericht(doc, projectId) {
  const p = get('SELECT * FROM projects WHERE id = ?', projectId);
  const vorlage = p.template_id ? get('SELECT * FROM templates WHERE id = ?', p.template_id) : null;
  const farben = H.gewerkFarben();
  const t = today();

  H.kopf(doc, { titel: 'Statusbericht', projekt: p.name, untertitel: `${p.geraetetyp}${p.gebaeude ? ' · Gebäude ' + p.gebaeude : ''}` });

  H.abschnitt(doc, 'Projektsteckbrief');
  H.absatz(doc, 'Gerätetyp', p.geraetetyp);
  H.absatz(doc, 'Gebäude / Ebene', `${p.gebaeude || '—'} / ${p.ebene || '—'}`);
  H.absatz(doc, 'Budgetrahmen', p.budget);
  H.absatz(doc, 'Status', lbl(p.status === 'aktiv' ? 'Aktiv' : p.status));
  H.absatz(doc, 'Vorlage', vorlage ? `${vorlage.name} (Version ${vorlage.version})` : '—');

  H.abschnitt(doc, 'Meilensteine');
  H.tabelle(doc, [
    { label: 'Meilenstein', breite: 0.5, get: (m) => m.name },
    { label: 'Datum', breite: 0.25, get: (m) => dat(m.datum) },
    { label: 'Stand', breite: 0.25, get: (m) => m.erledigt ? 'erreicht' : 'offen' },
  ], all('SELECT * FROM milestones WHERE project_id = ? ORDER BY sort_order', projectId));

  H.abschnitt(doc, 'Fortschritt je Phase');
  const phasen = all(
    `SELECT ph.nr, ph.name,
       SUM(CASE WHEN c.relevanz != 'nicht_relevant' THEN 1 ELSE 0 END) AS relevant,
       SUM(CASE WHEN c.relevanz != 'nicht_relevant' AND c.status = 'erledigt' THEN 1 ELSE 0 END) AS erledigt
     FROM phases ph LEFT JOIN checkpoints c ON c.phase_id = ph.id
     WHERE ph.project_id = ? GROUP BY ph.id ORDER BY ph.sort_order`, projectId);
  for (const ph of phasen) {
    H.seitenumbruch(doc, 18);
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).text(ph.name, H.RAND, y, { width: H.INHALT_BREITE * 0.52 - 8, lineBreak: false });
    H.balken(doc, H.RAND + H.INHALT_BREITE * 0.52, y + 1, H.INHALT_BREITE * 0.3, ph.relevant ? ph.erledigt / ph.relevant : 0);
    doc.text(`${ph.erledigt || 0}/${ph.relevant || 0}`, H.RAND + H.INHALT_BREITE * 0.85, y, { lineBreak: false });
    doc.y = y + 16;
  }
  doc.x = H.RAND;

  H.abschnitt(doc, 'Offene Punkte je Gewerk');
  const offene = all(
    `SELECT gewerke, termin, status FROM checkpoints
     WHERE project_id = ? AND relevanz != 'nicht_relevant' AND status != 'erledigt'`, projectId);
  const jeGewerk = {};
  for (const c of offene) {
    for (const g of (csvList(c.gewerke).length ? csvList(c.gewerke) : ['—'])) {
      jeGewerk[g] = jeGewerk[g] || { gewerk: g, offen: 0, ueberfaellig: 0, blockiert: 0 };
      jeGewerk[g].offen++;
      if (c.termin && c.termin < t) jeGewerk[g].ueberfaellig++;
      if (c.status === 'blockiert') jeGewerk[g].blockiert++;
    }
  }
  H.tabelle(doc, [
    { label: 'Gewerk', breite: 0.25, get: (r) => r.gewerk, chips: true },
    { label: 'Offen', breite: 0.25, get: (r) => String(r.offen) },
    { label: 'Überfällig', breite: 0.25, get: (r) => String(r.ueberfaellig), rot: (r) => r.ueberfaellig > 0 },
    { label: 'Blockiert', breite: 0.25, get: (r) => String(r.blockiert), rot: (r) => r.blockiert > 0 },
  ], Object.values(jeGewerk).sort((a, b) => b.offen - a.offen), { farben });

  H.abschnitt(doc, 'Dokumentenstand (Bereiche A–F)');
  H.tabelle(doc, [
    { label: 'Bereich', breite: 0.25, get: (r) => r.bereich },
    { label: 'Benötigt', breite: 0.25, get: (r) => String(r.benoetigt) },
    { label: 'Erhalten', breite: 0.25, get: (r) => String(r.erhalten) },
    { label: 'Fehlend', breite: 0.25, get: (r) => String(r.benoetigt - r.erhalten), rot: (r) => r.benoetigt - r.erhalten > 0 },
  ], all(
    `SELECT bereich,
       SUM(CASE WHEN benoetigt = 'ja' THEN 1 ELSE 0 END) AS benoetigt,
       SUM(CASE WHEN benoetigt = 'ja' AND erhalten_am IS NOT NULL THEN 1 ELSE 0 END) AS erhalten
     FROM document_entries WHERE project_id = ? GROUP BY bereich ORDER BY bereich`, projectId));

  H.abschnitt(doc, 'Blockierte Punkte (Top-Risiken)');
  H.tabelle(doc, [
    { label: 'Nr.', breite: 0.1, get: (r) => r.nr },
    { label: 'Punkt', breite: 0.45, get: (r) => r.text },
    { label: 'Gewerke', breite: 0.2, get: (r) => r.gewerke, chips: true },
    { label: 'Blocker', breite: 0.25, get: (r) => r.blocker_text || `${r.blocker_ref_typ || ''} #${r.blocker_ref_id || ''}` },
  ], all(`SELECT * FROM checkpoints WHERE project_id = ? AND status = 'blockiert' ORDER BY nr LIMIT 15`, projectId), { farben });

  H.abschnitt(doc, 'Überfällige Punkte');
  H.tabelle(doc, [
    { label: 'Nr.', breite: 0.1, get: (r) => r.nr },
    { label: 'Punkt', breite: 0.5, get: (r) => r.text },
    { label: 'Gewerke', breite: 0.2, get: (r) => r.gewerke, chips: true },
    { label: 'Termin', breite: 0.2, get: (r) => dat(r.termin), rot: () => true },
  ], all(
    `SELECT * FROM checkpoints WHERE project_id = ? AND relevanz != 'nicht_relevant'
     AND status != 'erledigt' AND termin IS NOT NULL AND termin < ? ORDER BY termin LIMIT 15`, projectId, t), { farben });

  const maengel = get(`SELECT COUNT(*) AS n FROM defects WHERE project_id = ? AND status != 'abgenommen'`, projectId).n;
  doc.moveDown(0.5);
  H.absatz(doc, 'Offene Mängel', String(maengel));

  // Anhang (Abnahmekriterium): Begründungen für nicht relevante Punkte
  doc.addPage();
  H.abschnitt(doc, 'Anhang: Nicht relevante Punkte mit Begründung');
  H.tabelle(doc, [
    { label: 'Nr.', breite: 0.1, get: (r) => r.nr },
    { label: 'Punkt', breite: 0.45, get: (r) => r.text },
    { label: 'Begründung', breite: 0.45, get: (r) => r.relevanz_begruendung },
  ], all(`SELECT nr, text, relevanz_begruendung FROM checkpoints WHERE project_id = ? AND relevanz = 'nicht_relevant' ORDER BY nr`, projectId),
    { leerText: 'Keine Punkte als „Nicht relevant" bewertet.' });

  H.fusszeilen(doc, p.name);
}

// ============ REP-02: Gewerke-Auszug ============
function gewerkAuszug(doc, projectId, kuerzel) {
  const p = get('SELECT * FROM projects WHERE id = ?', projectId);
  const farben = H.gewerkFarben();
  const daten = gewerkDaten(projectId, kuerzel);
  H.kopf(doc, { titel: `Gewerke-Auszug ${kuerzel}`, projekt: p.name, untertitel: 'Arbeitsgrundlage Fachplanung' });

  H.abschnitt(doc, `Offene Checkpunkte (${daten.punkte.length})`);
  H.tabelle(doc, [
    { label: 'Nr.', breite: 0.1, get: (r) => r.nr },
    { label: 'Punkt', breite: 0.5, get: (r) => r.text },
    { label: 'Status', breite: 0.15, get: (r) => lbl(r.status) },
    { label: 'Verantwortlich', breite: 0.13, get: (r) => r.verantwortlich_name },
    { label: 'Termin', breite: 0.12, get: (r) => dat(r.termin), rot: (r) => r.termin && r.termin < today() },
  ], daten.punkte, { farben });

  H.abschnitt(doc, `Raumbuch-Attribute (${daten.attribute.length})`);
  H.tabelle(doc, [
    { label: 'Raum', breite: 0.25, get: (r) => `${r.raum_nummer} ${r.raum_bezeichnung}` },
    { label: 'Attribut', breite: 0.25, get: (r) => r.name },
    { label: 'Soll', breite: 0.18, get: (r) => r.soll },
    { label: 'Ist', breite: 0.18, get: (r) => r.ist },
    { label: 'Status', breite: 0.14, get: (r) => lbl(r.status), rot: (r) => r.status === 'abweichend' },
  ], daten.attribute);

  H.abschnitt(doc, `Offene Protokollpunkte (${daten.protokollpunkte.length})`);
  H.tabelle(doc, [
    { label: 'Code', breite: 0.12, get: (r) => r.code },
    { label: 'Punkt', breite: 0.53, get: (r) => r.text },
    { label: 'Verantwortlich', breite: 0.2, get: (r) => r.verantwortlich_name },
    { label: 'Termin', breite: 0.15, get: (r) => dat(r.termin), rot: (r) => r.termin && r.termin < today() },
  ], daten.protokollpunkte);

  H.fusszeilen(doc, p.name);
}

function gewerkDaten(projectId, kuerzel) {
  const muster = `%,${kuerzel},%`;
  return {
    punkte: all(
      `SELECT c.*, k.name AS verantwortlich_name FROM checkpoints c
       LEFT JOIN contacts k ON k.id = c.verantwortlich_kontakt_id
       WHERE c.project_id = ? AND c.relevanz != 'nicht_relevant' AND c.status != 'erledigt'
         AND (',' || c.gewerke || ',') LIKE ? ORDER BY c.nr`, projectId, muster),
    attribute: all(
      `SELECT a.*, r.nummer AS raum_nummer, r.bezeichnung AS raum_bezeichnung
       FROM room_attributes a JOIN rooms r ON r.id = a.room_id
       WHERE r.project_id = ? AND a.gewerk = ? ORDER BY r.nummer, a.sort_order`, projectId, kuerzel),
    protokollpunkte: all(
      `SELECT p.*, k.name AS verantwortlich_name FROM protocol_items p
       LEFT JOIN contacts k ON k.id = p.verantwortlich_kontakt_id
       WHERE p.project_id = ? AND p.status = 'offen' AND p.gewerk = ? ORDER BY p.nummer`, projectId, kuerzel),
  };
}

// ============ RB-06: Raumbuch (aktuell oder Planstand) ============
function raumbuchDaten(projectId, planstandId) {
  if (planstandId) {
    const ps = get('SELECT * FROM plan_states WHERE id = ? AND project_id = ?', planstandId, projectId);
    if (!ps) return null;
    const snapshot = JSON.parse(ps.snapshot);
    return { planstand: ps, rooms: snapshot.raeume || snapshot.rooms || [] };
  }
  const rooms = all('SELECT * FROM rooms WHERE project_id = ? ORDER BY nummer', projectId).map((r) => ({
    ...r, attribute: all('SELECT * FROM room_attributes WHERE room_id = ? ORDER BY gewerk, sort_order', r.id),
  }));
  return { planstand: null, rooms };
}

function raumbuch(doc, projectId, planstandId) {
  const p = get('SELECT * FROM projects WHERE id = ?', projectId);
  const daten = raumbuchDaten(projectId, planstandId);
  const untertitel = daten.planstand
    ? `Planstand: ${daten.planstand.name} (${lbl(daten.planstand.typ)}) · ${dat(daten.planstand.datum)}${daten.planstand.freigabe_vermerk ? ' · Freigabe: ' + daten.planstand.freigabe_vermerk : ''}`
    : 'Arbeitsstand (nicht eingefroren)';
  H.kopf(doc, { titel: 'Raumbuch', projekt: p.name, untertitel });

  if (!daten.rooms.length) {
    doc.font('Helvetica-Oblique').fontSize(10).text('Keine Räume vorhanden.');
  }
  for (const raum of daten.rooms) {
    H.abschnitt(doc, `Raum ${raum.nummer} – ${raum.bezeichnung}`);
    doc.font('Helvetica').fontSize(9);
    const stamm = [
      ['Funktion', raum.funktion], ['Fläche', raum.flaeche_m2 ? `${raum.flaeche_m2} m²` : null],
      ['Lichte Höhe', raum.hoehe_m ? `${raum.hoehe_m} m` : null], ['Raumgruppe (VDE 0100-710)', raum.raumgruppe],
      ['Strahlenschutz', raum.strahlenschutz], ['HF-Anforderung', raum.hf_anforderung],
      ['Raumtyp', raum.raumtyp], ['Bemerkung', raum.bemerkung],
    ].filter(([, v]) => v);
    for (const [label, wert] of stamm) H.absatz(doc, label, wert);

    const jeGewerk = {};
    for (const a of raum.attribute || []) (jeGewerk[a.gewerk] = jeGewerk[a.gewerk] || []).push(a);
    for (const [gewerk, attrs] of Object.entries(jeGewerk)) {
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(10).text(gewerk, H.RAND);
      doc.moveDown(0.1);
      H.tabelle(doc, [
        { label: 'Attribut', breite: 0.3, get: (a) => a.name + (a.einheit ? ` [${a.einheit}]` : '') },
        { label: 'Soll', breite: 0.2, get: (a) => a.soll },
        { label: 'Ist', breite: 0.2, get: (a) => a.ist },
        { label: 'Status', breite: 0.13, get: (a) => lbl(a.status), rot: (a) => a.status === 'abweichend' },
        { label: 'Quelle/Kommentar', breite: 0.17, get: (a) => a.quelle },
      ], attrs);
    }
  }
  H.fusszeilen(doc, p.name);
}

// ============ PRO-05: Protokoll ============
function protokoll(doc, meetingId) {
  const m = get('SELECT * FROM meetings WHERE id = ?', meetingId);
  const p = get('SELECT * FROM projects WHERE id = ?', m.project_id);
  const serie = m.serie_id ? get('SELECT * FROM meeting_series WHERE id = ?', m.serie_id) : null;
  const farben = H.gewerkFarben();

  H.kopf(doc, {
    titel: `Protokoll: ${m.titel}`, projekt: p.name,
    untertitel: `${lbl(m.typ)}${serie ? ` · ${serie.titel} Nr. ${m.nr_in_serie}` : ''} · ${dat(m.datum)}${m.ort ? ' · ' + m.ort : ''} · Status: ${lbl(m.status)}`,
  });

  // ENTWURF-Markierung solange nicht festgestellt
  if (m.status !== 'festgestellt') {
    doc.save().rotate(-30, { origin: [H.SEITE.breite / 2, H.SEITE.hoehe / 2] })
      .font('Helvetica-Bold').fontSize(90).fillColor('#cccccc').opacity(0.25)
      .text('ENTWURF', 0, H.SEITE.hoehe / 2 - 60, { width: H.SEITE.breite, align: 'center' })
      .opacity(1).restore().fillColor('#222222');
  }

  const teilnehmer = all(
    `SELECT mp.status, k.name, k.firma FROM meeting_participants mp JOIN contacts k ON k.id = mp.contact_id
     WHERE mp.meeting_id = ? ORDER BY k.name`, m.id);
  H.abschnitt(doc, 'Teilnehmer');
  H.tabelle(doc, [
    { label: 'Name', breite: 0.4, get: (t) => t.name },
    { label: 'Firma', breite: 0.35, get: (t) => t.firma },
    { label: 'Teilnahme', breite: 0.25, get: (t) => lbl(t.status) },
  ], teilnehmer, { leerText: 'Keine Teilnehmer erfasst.' });

  let agenda = [];
  try { agenda = JSON.parse(m.agenda || '[]'); } catch { /* leer */ }
  if (agenda.length) {
    H.abschnitt(doc, 'Agenda');
    doc.font('Helvetica').fontSize(9);
    agenda.forEach((topEintrag, i) => doc.text(`${i + 1}. ${topEintrag.titel}`, H.RAND));
  }

  const punktSpalten = [
    { label: 'Code', breite: 0.1, get: (r) => r.code },
    { label: 'Typ', breite: 0.1, get: (r) => lbl(r.typ) },
    { label: 'Punkt', breite: 0.36, get: (r) => (r.nachtrag_zu_code ? `[Nachtrag zu ${r.nachtrag_zu_code}] ` : '') + r.text },
    { label: 'Gew.', breite: 0.09, get: (r) => r.gewerk, chips: true },
    { label: 'Verantwortlich', breite: 0.15, get: (r) => r.verantwortlich_name },
    { label: 'Termin', breite: 0.1, get: (r) => dat(r.termin), rot: (r) => r.termin && r.termin < today() && r.status === 'offen' },
    { label: 'Status', breite: 0.1, get: (r) => lbl(r.status) },
  ];

  // Übernommene offene Punkte früherer Besprechungen (alte zuerst) – PRO-04
  const paramsAlt = [m.project_id, m.datum, m.datum, m.id];
  let serienFilter = 'm2.serie_id IS NULL AND m2.typ = ?';
  if (m.serie_id) { serienFilter = 'm2.serie_id = ?'; }
  const alte = all(
    `SELECT pi.*, k.name AS verantwortlich_name, m2.titel AS herkunft_titel, m2.datum AS herkunft_datum,
       (SELECT code FROM protocol_items o WHERE o.id = pi.nachtrag_zu) AS nachtrag_zu_code
     FROM protocol_items pi
     JOIN meetings m2 ON m2.id = pi.meeting_id
     LEFT JOIN contacts k ON k.id = pi.verantwortlich_kontakt_id
     WHERE pi.project_id = ? AND pi.status = 'offen'
       AND (m2.datum < ? OR (m2.datum = ? AND m2.id < ?)) AND ${serienFilter}
     ORDER BY pi.nummer`, ...paramsAlt, ...(m.serie_id ? [m.serie_id] : [m.typ]));
  H.abschnitt(doc, 'Übernommene offene Punkte (alte zuerst)');
  H.tabelle(doc, punktSpalten, alte, { farben, leerText: 'Keine offenen Punkte aus früheren Besprechungen.' });

  const eigene = all(
    `SELECT pi.*, k.name AS verantwortlich_name,
       (SELECT code FROM protocol_items o WHERE o.id = pi.nachtrag_zu) AS nachtrag_zu_code
     FROM protocol_items pi LEFT JOIN contacts k ON k.id = pi.verantwortlich_kontakt_id
     WHERE pi.meeting_id = ? ORDER BY pi.nummer`, m.id);
  H.abschnitt(doc, 'Punkte dieser Besprechung');
  H.tabelle(doc, punktSpalten, eigene, { farben, leerText: 'Keine Punkte erfasst.' });

  H.fusszeilen(doc, p.name);
}

// ============ MGL-02: Mängelliste ============
function maengelliste(doc, projectId, filter = {}) {
  const p = get('SELECT * FROM projects WHERE id = ?', projectId);
  const farben = H.gewerkFarben();
  const bedingungen = ['d.project_id = ?'];
  const params = [projectId];
  const filterTexte = [];
  if (filter.gewerk) { bedingungen.push('d.gewerk = ?'); params.push(filter.gewerk); filterTexte.push(`Gewerk: ${filter.gewerk}`); }
  if (filter.firma) { bedingungen.push('d.firma = ?'); params.push(filter.firma); filterTexte.push(`Firma: ${filter.firma}`); }
  if (filter.status) { bedingungen.push('d.status = ?'); params.push(filter.status); filterTexte.push(`Status: ${lbl(filter.status)}`); }

  H.kopf(doc, { titel: 'Mängelliste', projekt: p.name, untertitel: filterTexte.length ? filterTexte.join(' · ') : 'Alle Mängel' });
  H.tabelle(doc, [
    { label: 'Nr.', breite: 0.08, get: (r) => `M-${String(r.nummer).padStart(3, '0')}` },
    { label: 'Beschreibung', breite: 0.34, get: (r) => r.beschreibung },
    { label: 'Raum', breite: 0.13, get: (r) => r.raum_nummer ? `${r.raum_nummer}` : '—' },
    { label: 'Gew.', breite: 0.08, get: (r) => r.gewerk, chips: true },
    { label: 'Firma', breite: 0.14, get: (r) => r.firma },
    { label: 'Frist', breite: 0.11, get: (r) => dat(r.frist), rot: (r) => r.frist && r.frist < today() && r.status !== 'abgenommen' },
    { label: 'Status', breite: 0.12, get: (r) => `${lbl(r.status)}${r.foto_anzahl ? ` (${r.foto_anzahl} Fotos)` : ''}` },
  ], all(
    `SELECT d.*, r.nummer AS raum_nummer,
       (SELECT COUNT(*) FROM photos ph WHERE ph.mangel_id = d.id) AS foto_anzahl
     FROM defects d LEFT JOIN rooms r ON r.id = d.room_id
     WHERE ${bedingungen.join(' AND ')} ORDER BY d.nummer`, ...params), { farben });
  H.fusszeilen(doc, p.name);
}

// ============ NOT-05: Bautagebuch / Journal ============
function journal(doc, projectId, von, bis) {
  const p = get('SELECT * FROM projects WHERE id = ?', projectId);
  const bedingungen = ['j.project_id = ?'];
  const params = [projectId];
  if (von) { bedingungen.push('j.datum >= ?'); params.push(von); }
  if (bis) { bedingungen.push('j.datum <= ?'); params.push(bis); }
  const eintraege = all(
    `SELECT j.*, u.display_name AS verfasser,
       (SELECT datum FROM journal_entries o WHERE o.id = j.nachtrag_zu) AS original_datum
     FROM journal_entries j LEFT JOIN users u ON u.id = j.verfasser_id
     WHERE ${bedingungen.join(' AND ')} ORDER BY j.datum, j.id`, ...params);

  H.kopf(doc, {
    titel: 'Bautagebuch', projekt: p.name,
    untertitel: `Zeitraum: ${von ? dat(von) : 'Anfang'} – ${bis ? dat(bis) : 'heute'} · ${eintraege.length} Einträge`,
  });

  for (const e of eintraege) {
    H.seitenumbruch(doc, 60);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(11)
      .text(`${dat(e.datum)} · ${lbl(e.kategorie)}${e.nachtrag_zu ? ` · Nachtrag zum Eintrag vom ${dat(e.original_datum)}` : ''}`, H.RAND);
    doc.font('Helvetica').fontSize(8).fillColor('#666666')
      .text([e.verfasser, e.wetter ? `Wetter: ${e.wetter}` : null, e.anwesende ? `Anwesend: ${e.anwesende}` : null].filter(Boolean).join(' · '));
    doc.fillColor('#222222').fontSize(9).moveDown(0.2).text(e.text, { width: H.INHALT_BREITE });

    const fotos = all(`SELECT * FROM photos WHERE journal_id = ? AND (mime LIKE 'image/jpeg' OR mime LIKE 'image/png')`, e.id);
    for (const foto of fotos) {
      try {
        H.seitenumbruch(doc, 160);
        doc.image(path.join(UPLOAD_DIR, foto.path), H.RAND, doc.y + 4, { fit: [220, 150] });
        doc.y += 160;
        doc.font('Helvetica').fontSize(7).fillColor('#666666')
          .text(`${foto.filename}${foto.beschreibung ? ' – ' + foto.beschreibung : ''} (${dat(foto.aufnahme_zeit)})`, H.RAND);
        doc.fillColor('#222222');
      } catch {
        doc.font('Helvetica-Oblique').fontSize(8).text(`[Foto ${foto.filename} konnte nicht eingebettet werden]`, H.RAND);
      }
    }
  }
  if (!eintraege.length) doc.font('Helvetica-Oblique').fontSize(10).text('Keine Einträge im gewählten Zeitraum.');
  H.fusszeilen(doc, p.name);
}

// ============ DOK-03: Vollständigkeitsbericht ============
function vollstaendigkeit(doc, projectId) {
  const p = get('SELECT * FROM projects WHERE id = ?', projectId);
  const farben = H.gewerkFarben();
  const fehlend = all(
    `SELECT d.*, k.name AS verantwortlich_name FROM document_entries d
     LEFT JOIN contacts k ON k.id = d.verantwortlich_kontakt_id
     WHERE d.project_id = ? AND d.benoetigt = 'ja' AND d.erhalten_am IS NULL ORDER BY d.bereich, d.nr`, projectId);
  H.kopf(doc, { titel: 'Dokumenten-Vollständigkeitsbericht', projekt: p.name, untertitel: `${fehlend.length} benötigte Dokumente stehen aus` });

  const bereiche = [...new Set(fehlend.map((d) => d.bereich))];
  for (const bereich of bereiche) {
    H.abschnitt(doc, `Bereich ${bereich}`);
    H.tabelle(doc, [
      { label: 'Nr.', breite: 0.1, get: (r) => r.nr },
      { label: 'Dokument', breite: 0.42, get: (r) => r.titel },
      { label: 'Gew.', breite: 0.1, get: (r) => r.gewerk, chips: true },
      { label: 'Fälligkeit', breite: 0.15, get: (r) => dat(r.faelligkeit), rot: (r) => r.faelligkeit && r.faelligkeit < today() },
      { label: 'Verantwortlich', breite: 0.23, get: (r) => r.verantwortlich_name },
    ], fehlend.filter((d) => d.bereich === bereich), { farben });
  }
  if (!fehlend.length) doc.font('Helvetica').fontSize(11).fillColor('#1e8a4c').text('Alle benötigten Dokumente liegen vor.').fillColor('#222222');
  H.fusszeilen(doc, p.name);
}

module.exports = { statusbericht, gewerkAuszug, gewerkDaten, raumbuch, raumbuchDaten, protokoll, maengelliste, journal, vollstaendigkeit };
