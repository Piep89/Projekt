// M3 – Raumbuch: Räume (Einzelanlage + CSV-Import), Attributkataloge je Gewerk,
// Gewerke-Matrix (Massenpflege), Soll/Ist-Abweichungen und Planstände mit
// Delta-Ansicht (RB-01…RB-08, INT-01)
const express = require('express');
const { get, all, run, tx } = require('../db');
const { now, today, ApiError, parseCsv } = require('../util');
const { audit, diff } = require('../audit');
const { requireAuth, requireProject, canWriteGewerk } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const ATTRIBUT_STATI = ['offen', 'festgelegt', 'bestaetigt', 'abweichend'];
const PLANSTAND_TYPEN = ['vorplanung', 'entwurf', 'ausfuehrung', 'as_built', 'sonstig'];
const DATENTYPEN = ['zahl', 'text', 'auswahl', 'janein'];
const STAMM_FELDER = ['nummer', 'bezeichnung', 'funktion', 'flaeche_m2', 'hoehe_m',
  'raumgruppe', 'strahlenschutz', 'hf_anforderung', 'raumtyp', 'bemerkung'];
// Stammdaten-Felder für den Planstand-Vergleich (Raumnummer ist der Schlüssel)
const DELTA_STAMM_FELDER = STAMM_FELDER.filter((f) => f !== 'nummer');

// ---------------- Helfer ----------------
function num(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// Projekt-ID-Resolver für Objekt-Routen ohne projectId im Pfad
const roomProject = (req) => {
  const id = num(req.params.id);
  return id ? (get('SELECT project_id FROM rooms WHERE id = ?', id)?.project_id ?? 0) : 0;
};
const attrProject = (req) => {
  const id = num(req.params.id);
  return id ? (get(`SELECT r.project_id AS project_id FROM room_attributes a
                    JOIN rooms r ON r.id = a.room_id WHERE a.id = ?`, id)?.project_id ?? 0) : 0;
};
const planstandProject = (req) => {
  const id = num(req.params.id);
  return id ? (get('SELECT project_id FROM plan_states WHERE id = ?', id)?.project_id ?? 0) : 0;
};

// Zahlfeld hart validieren; deutsches Komma wird akzeptiert. Leer -> null.
function parseZahl(value, feldName) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(String(value).trim().replace(/\s+/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new ApiError(400, `${feldName} muss eine Zahl sein (erhalten: '${value}')`);
  return n;
}

// Attribute eines Raumtyps aus der Projektvorlage vorbelegen (RB-02);
// vorhandene Attribute (Raum+Gewerk+Name) werden übersprungen. Liefert Anzahl.
function raumtypVorbelegen(templateId, raumtyp, roomId) {
  if (!templateId || !raumtyp) return 0;
  const rt = get('SELECT * FROM template_room_types WHERE template_id = ? AND name = ?', templateId, raumtyp);
  if (!rt) return 0;
  let liste = [];
  try { liste = JSON.parse(rt.attribut_namen || '[]'); } catch { liste = []; }
  let n = 0;
  liste.forEach((w, i) => {
    if (!w || !w.gewerk || !w.name) return;
    const ka = get('SELECT * FROM template_attributes WHERE template_id = ? AND gewerk = ? AND name = ?',
      templateId, w.gewerk, w.name);
    if (!ka) return;
    if (get('SELECT id FROM room_attributes WHERE room_id = ? AND gewerk = ? AND name = ?', roomId, ka.gewerk, ka.name)) return;
    run('INSERT INTO room_attributes (room_id, gewerk, name, datentyp, einheit, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      roomId, ka.gewerk, ka.name, ka.datentyp, ka.einheit, i);
    n++;
  });
  return n;
}

// Kompletter aktueller Raumbuch-Stand (für Snapshots und Delta 'aktuell')
function aktuellerStand(projectId) {
  return all('SELECT * FROM rooms WHERE project_id = ? ORDER BY nummer', projectId).map((r) => ({
    ...r,
    attribute: all(`SELECT id, gewerk, name, datentyp, einheit, soll, ist, status, quelle, sort_order
                    FROM room_attributes WHERE room_id = ? ORDER BY gewerk, sort_order, name`, r.id),
  }));
}

function snapshotLesen(planstand) {
  try {
    const s = JSON.parse(planstand.snapshot);
    return Array.isArray(s.raeume) ? s : { raeume: [] };
  } catch {
    throw new ApiError(500, `Snapshot des Planstands '${planstand.name}' ist beschädigt`);
  }
}

// ============================================================
// Räume
// ============================================================

// Raumliste mit Kennzahlen je Raum (Attribute, Abweichungen, offene Punkte/Mängel, Fotos)
router.get('/projects/:projectId/rooms', requireProject('read'), (req, res) => {
  res.json(all(
    `SELECT r.*,
       (SELECT COUNT(*) FROM room_attributes a WHERE a.room_id = r.id) AS attribut_anzahl,
       (SELECT COUNT(*) FROM room_attributes a WHERE a.room_id = r.id
          AND (a.status = 'abweichend'
               OR (COALESCE(a.soll,'') != '' AND COALESCE(a.ist,'') != '' AND a.ist != a.soll))) AS abweichungen,
       (SELECT COUNT(*) FROM checkpoints c
          WHERE c.relevanz != 'nicht_relevant' AND c.status != 'erledigt' AND c.id IN (
            SELECT to_id FROM links WHERE from_typ = 'room' AND from_id = r.id AND to_typ = 'checkpoint'
            UNION
            SELECT from_id FROM links WHERE to_typ = 'room' AND to_id = r.id AND from_typ = 'checkpoint')) AS offene_punkte,
       (SELECT COUNT(*) FROM defects d WHERE d.room_id = r.id AND d.status != 'abgenommen') AS offene_maengel,
       (SELECT COUNT(*) FROM photos p WHERE p.room_id = r.id) AS fotos
     FROM rooms r WHERE r.project_id = ? ORDER BY r.nummer`, req.project.id));
});

// Raum anlegen (RB-01); Raumtyp belegt Attribute aus der Projektvorlage vor (RB-02)
router.post('/projects/:projectId/rooms', requireProject('write'), (req, res, next) => {
  try {
    const b = req.body || {};
    const nummer = String(b.nummer || '').trim();
    const bezeichnung = String(b.bezeichnung || '').trim();
    if (!nummer) throw new ApiError(400, 'Raumnummer ist Pflicht');
    if (!bezeichnung) throw new ApiError(400, 'Bezeichnung ist Pflicht');
    if (get('SELECT id FROM rooms WHERE project_id = ? AND nummer = ?', req.project.id, nummer)) {
      throw new ApiError(409, `Raumnummer '${nummer}' existiert bereits in diesem Projekt`);
    }
    const flaeche = parseZahl(b.flaeche_m2, 'Fläche');
    const hoehe = parseZahl(b.hoehe_m, 'Höhe');
    const text = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

    const ergebnis = tx(() => {
      const r = run(
        `INSERT INTO rooms (project_id, nummer, bezeichnung, funktion, flaeche_m2, hoehe_m,
           raumgruppe, strahlenschutz, hf_anforderung, raumtyp, bemerkung, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.project.id, nummer, bezeichnung, text(b.funktion), flaeche, hoehe,
        text(b.raumgruppe), text(b.strahlenschutz), text(b.hf_anforderung), text(b.raumtyp), text(b.bemerkung), now());
      const roomId = Number(r.lastInsertRowid);
      const attribute = raumtypVorbelegen(req.project.template_id, text(b.raumtyp), roomId);
      return { id: roomId, attribute };
    });
    audit(req, req.project.id, 'room', ergebnis.id, 'erstellt',
      { nummer, bezeichnung, raumtyp: text(b.raumtyp), attribute_vorbelegt: ergebnis.attribute });
    res.status(201).json(ergebnis);
  } catch (e) { next(e); }
});

// CSV-Import (RB-01/INT-01): Spalten Nummer;Bezeichnung;Funktion;Flaeche;Hoehe;Raumgruppe;Raumtyp;Bemerkung
// commit=false -> Vorschau {ok, fehler}, commit=true -> anlegen inkl. Raumtyp-Vorbelegung
router.post('/projects/:projectId/rooms/import', requireProject('write'), (req, res, next) => {
  try {
    const { csv, commit } = req.body || {};
    if (!csv || !String(csv).trim()) throw new ApiError(400, 'CSV-Inhalt fehlt');
    const zeilen = parseCsv(String(csv));
    if (!zeilen.length) throw new ApiError(400, 'CSV enthält keine auswertbaren Zeilen');

    // Kopfzeile erkennen und überspringen
    const kopf = zeilen[0].map((z) => String(z).trim().toLowerCase());
    const start = (kopf[0] === 'nummer' || kopf.includes('bezeichnung')) ? 1 : 0;
    if (start === 1 && zeilen.length === 1) throw new ApiError(400, 'CSV enthält nur eine Kopfzeile, keine Datenzeilen');

    const ok = [];
    const fehler = [];
    const gesehen = new Set();
    for (let i = start; i < zeilen.length; i++) {
      const zeile = i + 1;
      const felder = zeilen[i].map((z) => String(z ?? '').trim());
      const [nummer, bezeichnung, funktion, flaeche, hoehe, raumgruppe, raumtyp, bemerkung] =
        [...felder, '', '', '', '', '', '', '', ''];
      const gruende = [];
      if (!nummer) gruende.push('Nummer fehlt (Pflichtfeld)');
      if (!bezeichnung) gruende.push('Bezeichnung fehlt (Pflichtfeld)');
      let flaecheZahl = null;
      let hoeheZahl = null;
      try { flaecheZahl = parseZahl(flaeche, 'Flaeche'); } catch { gruende.push(`Flaeche '${flaeche}' ist keine Zahl`); }
      try { hoeheZahl = parseZahl(hoehe, 'Hoehe'); } catch { gruende.push(`Hoehe '${hoehe}' ist keine Zahl`); }
      if (nummer && gesehen.has(nummer)) gruende.push(`Nummer '${nummer}' ist in der Datei doppelt`);
      if (nummer && get('SELECT id FROM rooms WHERE project_id = ? AND nummer = ?', req.project.id, nummer)) {
        gruende.push(`Nummer '${nummer}' existiert bereits im Projekt`);
      }
      if (nummer) gesehen.add(nummer);
      if (gruende.length) { fehler.push({ zeile, grund: gruende.join('; ') }); continue; }
      const raumtypBekannt = raumtyp
        ? Boolean(req.project.template_id
            && get('SELECT id FROM template_room_types WHERE template_id = ? AND name = ?', req.project.template_id, raumtyp))
        : null;
      ok.push({
        zeile, nummer, bezeichnung,
        funktion: funktion || null, flaeche_m2: flaecheZahl, hoehe_m: hoeheZahl,
        raumgruppe: raumgruppe || null, raumtyp: raumtyp || null, bemerkung: bemerkung || null,
        raumtyp_bekannt: raumtypBekannt,
      });
    }

    if (!commit) return res.json({ ok, fehler });
    if (fehler.length) throw new ApiError(400, `CSV enthält ${fehler.length} fehlerhafte Zeile(n) – Import abgebrochen. Erste Meldung: Zeile ${fehler[0].zeile}: ${fehler[0].grund}`);
    if (!ok.length) throw new ApiError(400, 'Keine importierbaren Zeilen gefunden');

    const angelegt = tx(() => ok.map((z) => {
      const r = run(
        `INSERT INTO rooms (project_id, nummer, bezeichnung, funktion, flaeche_m2, hoehe_m, raumgruppe, raumtyp, bemerkung, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.project.id, z.nummer, z.bezeichnung, z.funktion, z.flaeche_m2, z.hoehe_m, z.raumgruppe, z.raumtyp, z.bemerkung, now());
      const roomId = Number(r.lastInsertRowid);
      const attribute = raumtypVorbelegen(req.project.template_id, z.raumtyp, roomId);
      return { id: roomId, nummer: z.nummer, bezeichnung: z.bezeichnung, attribute };
    }));
    for (const a of angelegt) {
      audit(req, req.project.id, 'room', a.id, 'erstellt',
        { nummer: a.nummer, bezeichnung: a.bezeichnung, quelle: 'CSV-Import', attribute_vorbelegt: a.attribute });
    }
    res.status(201).json({ importiert: angelegt.length, raeume: angelegt });
  } catch (e) { next(e); }
});

// Raumdetail (RB-07): Stammdaten + Attribute je Gewerk + offene verknüpfte
// Checkpunkte + Mängel + Fotos
router.get('/rooms/:id', requireProject('read', roomProject), (req, res, next) => {
  try {
    const raum = get('SELECT * FROM rooms WHERE id = ?', num(req.params.id));
    if (!raum) throw new ApiError(404, 'Raum nicht gefunden');
    const attribute = {};
    for (const a of all('SELECT * FROM room_attributes WHERE room_id = ? ORDER BY gewerk, sort_order, name', raum.id)) {
      (attribute[a.gewerk] = attribute[a.gewerk] || []).push(a);
    }
    res.json({
      ...raum,
      attribute,
      offene_punkte: all(
        `SELECT c.id, c.nr, c.text, c.status, c.termin, c.gewerke FROM checkpoints c
         WHERE c.relevanz != 'nicht_relevant' AND c.status != 'erledigt' AND c.id IN (
           SELECT to_id FROM links WHERE from_typ = 'room' AND from_id = ? AND to_typ = 'checkpoint'
           UNION
           SELECT from_id FROM links WHERE to_typ = 'room' AND to_id = ? AND from_typ = 'checkpoint')
         ORDER BY c.nr`, raum.id, raum.id),
      maengel: all(
        `SELECT id, nummer, beschreibung, gewerk, firma, frist, status
         FROM defects WHERE room_id = ? ORDER BY nummer`, raum.id),
      fotos: all(
        `SELECT id, filename, beschreibung, aufnahme_zeit
         FROM photos WHERE room_id = ? ORDER BY aufnahme_zeit DESC`, raum.id),
    });
  } catch (e) { next(e); }
});

// Stammdaten ändern (Audit mit Diff)
router.patch('/rooms/:id', requireProject('write', roomProject), (req, res, next) => {
  try {
    const raum = get('SELECT * FROM rooms WHERE id = ?', num(req.params.id));
    if (!raum) throw new ApiError(404, 'Raum nicht gefunden');
    const b = req.body || {};
    const neu = { ...raum };
    for (const f of ['nummer', 'bezeichnung', 'funktion', 'raumgruppe', 'strahlenschutz', 'hf_anforderung', 'raumtyp', 'bemerkung']) {
      if (b[f] !== undefined) neu[f] = (b[f] === null || String(b[f]).trim() === '') ? null : String(b[f]).trim();
    }
    if (!neu.nummer) throw new ApiError(400, 'Raumnummer ist Pflicht');
    if (!neu.bezeichnung) throw new ApiError(400, 'Bezeichnung ist Pflicht');
    if (b.flaeche_m2 !== undefined) neu.flaeche_m2 = parseZahl(b.flaeche_m2, 'Fläche');
    if (b.hoehe_m !== undefined) neu.hoehe_m = parseZahl(b.hoehe_m, 'Höhe');
    if (neu.nummer !== raum.nummer
        && get('SELECT id FROM rooms WHERE project_id = ? AND nummer = ? AND id != ?', raum.project_id, neu.nummer, raum.id)) {
      throw new ApiError(409, `Raumnummer '${neu.nummer}' existiert bereits in diesem Projekt`);
    }
    run(`UPDATE rooms SET nummer=?, bezeichnung=?, funktion=?, flaeche_m2=?, hoehe_m=?,
           raumgruppe=?, strahlenschutz=?, hf_anforderung=?, raumtyp=?, bemerkung=? WHERE id=?`,
      neu.nummer, neu.bezeichnung, neu.funktion, neu.flaeche_m2, neu.hoehe_m,
      neu.raumgruppe, neu.strahlenschutz, neu.hf_anforderung, neu.raumtyp, neu.bemerkung, raum.id);
    const details = diff(raum, neu, STAMM_FELDER);
    if (Object.keys(details).length) audit(req, raum.project_id, 'room', raum.id, 'geaendert', details);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// Raum löschen – nur ohne verknüpfte Mängel/Fotos
router.delete('/rooms/:id', requireProject('write', roomProject), (req, res, next) => {
  try {
    const raum = get('SELECT * FROM rooms WHERE id = ?', num(req.params.id));
    if (!raum) throw new ApiError(404, 'Raum nicht gefunden');
    const maengel = get('SELECT COUNT(*) AS n FROM defects WHERE room_id = ?', raum.id).n;
    const fotos = get('SELECT COUNT(*) AS n FROM photos WHERE room_id = ?', raum.id).n;
    if (maengel || fotos) {
      throw new ApiError(400,
        `Raum kann nicht gelöscht werden: ${maengel} Mangel/Mängel und ${fotos} Foto(s) sind zugeordnet`);
    }
    tx(() => {
      require('../papierkorb').inPapierkorb(req, raum.project_id, 'rooms', `Raum ${raum.nummer} – ${raum.bezeichnung}`, {
        zeile: raum,
        attribute: all('SELECT * FROM room_attributes WHERE room_id = ?', raum.id),
      });
      run("DELETE FROM links WHERE (from_typ = 'room' AND from_id = ?) OR (to_typ = 'room' AND to_id = ?)", raum.id, raum.id);
      run('DELETE FROM rooms WHERE id = ?', raum.id); // room_attributes fallen per ON DELETE CASCADE
    });
    audit(req, raum.project_id, 'room', raum.id, 'geloescht', { nummer: raum.nummer, bezeichnung: raum.bezeichnung });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============================================================
// Attributkatalog und Raum-Attribute (RB-02/RB-04)
// ============================================================

// Katalog der Projektvorlage: Attribute je Gewerk + Raumtypen
router.get('/projects/:projectId/attribut-katalog', requireProject('read'), (req, res) => {
  const templateId = req.project.template_id;
  if (!templateId) return res.json({ attribute: [], raumtypen: [] });
  const attribute = all(
    `SELECT id, gewerk, name, datentyp, einheit, auswahl_optionen, hilfetext, sort_order
     FROM template_attributes WHERE template_id = ? ORDER BY gewerk, sort_order, name`, templateId);
  const raumtypen = all(
    'SELECT id, name, attribut_namen FROM template_room_types WHERE template_id = ? ORDER BY name', templateId)
    .map((rt) => {
      let attr = [];
      try { attr = JSON.parse(rt.attribut_namen || '[]'); } catch { attr = []; }
      return { id: rt.id, name: rt.name, attribute: attr };
    });
  res.json({ attribute, raumtypen });
});

// Attribute zu einem Raum hinzufügen: aus dem Katalog (katalog_ids) oder frei
router.post('/rooms/:id/attributes', requireProject('write', roomProject), (req, res, next) => {
  try {
    const raum = get('SELECT * FROM rooms WHERE id = ?', num(req.params.id));
    if (!raum) throw new ApiError(404, 'Raum nicht gefunden');
    const b = req.body || {};
    const maxSort = () => get('SELECT COALESCE(MAX(sort_order),0) AS m FROM room_attributes WHERE room_id = ?', raum.id).m;

    // Variante 1: Übernahme aus dem Vorlagenkatalog (Duplikate je Raum+Gewerk+Name überspringen)
    if (b.katalog_ids !== undefined) {
      if (!Array.isArray(b.katalog_ids) || !b.katalog_ids.length) throw new ApiError(400, 'katalog_ids muss eine nicht-leere Liste sein');
      const templateId = req.project.template_id;
      if (!templateId) throw new ApiError(400, 'Projekt hat keine Vorlage – kein Attributkatalog verfügbar');
      const angelegt = [];
      const uebersprungen = [];
      tx(() => {
        let sort = maxSort();
        for (const kid of b.katalog_ids) {
          const ka = get('SELECT * FROM template_attributes WHERE id = ? AND template_id = ?', num(kid), templateId);
          if (!ka) throw new ApiError(400, `Katalog-Attribut #${kid} gehört nicht zur Projektvorlage`);
          if (!canWriteGewerk(req.access, ka.gewerk)) throw new ApiError(403, `Keine Schreibrechte für Gewerk ${ka.gewerk}`);
          if (get('SELECT id FROM room_attributes WHERE room_id = ? AND gewerk = ? AND name = ?', raum.id, ka.gewerk, ka.name)) {
            uebersprungen.push(`${ka.gewerk}: ${ka.name}`);
            continue;
          }
          run('INSERT INTO room_attributes (room_id, gewerk, name, datentyp, einheit, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
            raum.id, ka.gewerk, ka.name, ka.datentyp, ka.einheit, ++sort);
          angelegt.push(`${ka.gewerk}: ${ka.name}`);
        }
      });
      if (angelegt.length) {
        audit(req, raum.project_id, 'room', raum.id, 'geaendert', { attribute_hinzugefuegt: angelegt });
      }
      return res.status(201).json({ angelegt: angelegt.length, uebersprungen });
    }

    // Variante 2: freies Attribut {gewerk, name, datentyp, einheit}
    const gewerk = String(b.gewerk || '').trim();
    const name = String(b.name || '').trim();
    if (!gewerk) throw new ApiError(400, 'Gewerk ist Pflicht');
    if (!name) throw new ApiError(400, 'Attributname ist Pflicht');
    const g = get('SELECT kuerzel FROM gewerke WHERE kuerzel = ? AND active = 1', gewerk);
    if (!g) throw new ApiError(400, `Unbekanntes Gewerk '${gewerk}'`);
    const datentyp = b.datentyp === undefined || b.datentyp === null || b.datentyp === '' ? 'text' : String(b.datentyp);
    if (!DATENTYPEN.includes(datentyp)) throw new ApiError(400, `Datentyp muss einer von: ${DATENTYPEN.join(', ')} sein`);
    if (!canWriteGewerk(req.access, g.kuerzel)) throw new ApiError(403, `Keine Schreibrechte für Gewerk ${g.kuerzel}`);
    if (get('SELECT id FROM room_attributes WHERE room_id = ? AND gewerk = ? AND name = ?', raum.id, g.kuerzel, name)) {
      throw new ApiError(409, `Attribut '${name}' existiert für Gewerk ${g.kuerzel} an diesem Raum bereits`);
    }
    const einheit = b.einheit && String(b.einheit).trim() ? String(b.einheit).trim() : null;
    const r = run('INSERT INTO room_attributes (room_id, gewerk, name, datentyp, einheit, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      raum.id, g.kuerzel, name, datentyp, einheit, maxSort() + 1);
    audit(req, raum.project_id, 'room', raum.id, 'geaendert', { attribute_hinzugefuegt: [`${g.kuerzel}: ${name}`] });
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) { next(e); }
});

// Attributpflege (RB-04): Soll, Ist, Status, Quelle – gewerkegebunden (ROL-03)
router.patch('/room-attributes/:id', requireProject('write', attrProject), (req, res, next) => {
  try {
    const attr = get(
      `SELECT a.*, r.project_id AS project_id FROM room_attributes a
       JOIN rooms r ON r.id = a.room_id WHERE a.id = ?`, num(req.params.id));
    if (!attr) throw new ApiError(404, 'Attribut nicht gefunden');
    if (!canWriteGewerk(req.access, attr.gewerk)) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');

    const b = req.body || {};
    const neu = { soll: attr.soll, ist: attr.ist, status: attr.status, quelle: attr.quelle };
    for (const f of ['soll', 'ist', 'quelle']) {
      if (b[f] !== undefined) neu[f] = (b[f] === null || String(b[f]).trim() === '') ? null : String(b[f]).trim();
    }
    if (b.status !== undefined) {
      if (!ATTRIBUT_STATI.includes(b.status)) throw new ApiError(400, `Status muss einer von: ${ATTRIBUT_STATI.join(', ')} sein`);
      neu.status = b.status;
    }
    // Datentyp-Validierung der Werte
    if (attr.datentyp === 'zahl') {
      for (const f of ['soll', 'ist']) {
        if (b[f] !== undefined && neu[f] !== null) neu[f] = String(parseZahl(neu[f], f === 'soll' ? 'Soll' : 'Ist'));
      }
    }
    if (attr.datentyp === 'janein') {
      for (const f of ['soll', 'ist']) {
        if (b[f] !== undefined && neu[f] !== null) {
          const wert = neu[f].toLowerCase();
          if (!['ja', 'nein'].includes(wert)) throw new ApiError(400, `${f === 'soll' ? 'Soll' : 'Ist'} muss 'ja' oder 'nein' sein`);
          neu[f] = wert;
        }
      }
    }

    run('UPDATE room_attributes SET soll=?, ist=?, status=?, quelle=? WHERE id=?',
      neu.soll, neu.ist, neu.status, neu.quelle, attr.id);
    const details = { attribut: attr.name, gewerk: attr.gewerk };
    let geaendert = false;
    for (const f of ['soll', 'ist', 'status', 'quelle']) {
      if (String(attr[f] ?? '') !== String(neu[f] ?? '')) {
        details[f] = { von: attr[f] ?? null, nach: neu[f] };
        geaendert = true;
      }
    }
    if (geaendert) audit(req, attr.project_id, 'room', attr.room_id, 'geaendert', details);
    res.json({ ok: true, attribut: { id: attr.id, gewerk: attr.gewerk, name: attr.name, datentyp: attr.datentyp, einheit: attr.einheit, ...neu } });
  } catch (e) { next(e); }
});

router.delete('/room-attributes/:id', requireProject('write', attrProject), (req, res, next) => {
  try {
    const attr = get(
      `SELECT a.*, r.project_id AS project_id FROM room_attributes a
       JOIN rooms r ON r.id = a.room_id WHERE a.id = ?`, num(req.params.id));
    if (!attr) throw new ApiError(404, 'Attribut nicht gefunden');
    if (!canWriteGewerk(req.access, attr.gewerk)) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');
    run('DELETE FROM room_attributes WHERE id = ?', attr.id);
    audit(req, attr.project_id, 'room', attr.room_id, 'geaendert',
      { attribut_geloescht: attr.name, gewerk: attr.gewerk });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============================================================
// Gewerke-Matrix (RB-03) und Abweichungen (RB-04)
// ============================================================

router.get('/projects/:projectId/room-matrix', requireProject('read'), (req, res, next) => {
  try {
    const gewerk = String(req.query.gewerk || '').trim();
    if (!gewerk) throw new ApiError(400, "Parameter 'gewerk' fehlt");
    const attributNamen = all(
      `SELECT a.name FROM room_attributes a JOIN rooms r ON r.id = a.room_id
       WHERE r.project_id = ? AND a.gewerk = ?
       GROUP BY a.name ORDER BY MIN(a.sort_order), a.name`, req.project.id, gewerk).map((x) => x.name);
    const zeilen = all('SELECT id, nummer, bezeichnung FROM rooms WHERE project_id = ? ORDER BY nummer', req.project.id)
      .map((r) => {
        const werte = {};
        for (const a of all(
          'SELECT id, name, soll, ist, status, quelle, datentyp, einheit FROM room_attributes WHERE room_id = ? AND gewerk = ?',
          r.id, gewerk)) {
          werte[a.name] = { id: a.id, soll: a.soll, ist: a.ist, status: a.status, quelle: a.quelle, datentyp: a.datentyp, einheit: a.einheit };
        }
        return { room_id: r.id, nummer: r.nummer, bezeichnung: r.bezeichnung, werte };
      });
    res.json({ gewerk, attribut_namen: attributNamen, zeilen });
  } catch (e) { next(e); }
});

// Abweichungsauswertung: Status 'abweichend' ODER Ist weicht vom Soll ab
router.get('/projects/:projectId/abweichungen', requireProject('read'), (req, res) => {
  res.json(all(
    `SELECT a.id, a.gewerk, a.name, a.datentyp, a.einheit, a.soll, a.ist, a.status, a.quelle,
            r.id AS room_id, r.nummer, r.bezeichnung
     FROM room_attributes a JOIN rooms r ON r.id = a.room_id
     WHERE r.project_id = ?
       AND (a.status = 'abweichend'
            OR (COALESCE(a.soll,'') != '' AND COALESCE(a.ist,'') != '' AND a.ist != a.soll))
     ORDER BY r.nummer, a.gewerk, a.sort_order, a.name`, req.project.id));
});

// ============================================================
// Planstände (RB-05)
// ============================================================

router.get('/projects/:projectId/planstaende', requireProject('read'), (req, res) => {
  res.json(all(
    `SELECT ps.id, ps.name, ps.typ, ps.datum, ps.freigabe_vermerk, ps.created_at,
            u.display_name AS ersteller
     FROM plan_states ps LEFT JOIN users u ON u.id = ps.created_by
     WHERE ps.project_id = ? ORDER BY ps.created_at DESC, ps.id DESC`, req.project.id));
});

// Planstand einfrieren: Snapshot ALLER Räume + Attribute
router.post('/projects/:projectId/planstaende', requireProject('write'), (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!name) throw new ApiError(400, 'Name ist Pflicht');
    const typ = b.typ === undefined || b.typ === null || b.typ === '' ? 'sonstig' : String(b.typ);
    if (!PLANSTAND_TYPEN.includes(typ)) throw new ApiError(400, `Typ muss einer von: ${PLANSTAND_TYPEN.join(', ')} sein`);
    const stand = aktuellerStand(req.project.id);
    const r = run(
      `INSERT INTO plan_states (project_id, name, typ, datum, freigabe_vermerk, snapshot, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      req.project.id, name, typ, today(),
      b.freigabe_vermerk && String(b.freigabe_vermerk).trim() ? String(b.freigabe_vermerk).trim() : null,
      JSON.stringify({ erstellt: now(), raeume: stand }), req.user.id, now());
    const id = Number(r.lastInsertRowid);
    audit(req, req.project.id, 'planstand', id, 'erstellt', { name, typ, raeume: stand.length });
    res.status(201).json({ id, raeume: stand.length });
  } catch (e) { next(e); }
});

// Delta zweier Stände (RB-05): von=<Planstand-ID>, bis=<Planstand-ID|aktuell>
router.get('/projects/:projectId/planstaende/delta', requireProject('read'), (req, res, next) => {
  try {
    const vonId = num(req.query.von);
    if (!vonId) throw new ApiError(400, "Parameter 'von' (Planstand-ID) fehlt oder ist ungültig");
    const von = get('SELECT * FROM plan_states WHERE id = ? AND project_id = ?', vonId, req.project.id);
    if (!von) throw new ApiError(404, "Planstand 'von' nicht gefunden");

    const bisParam = String(req.query.bis || 'aktuell');
    let bisRaeume;
    let bisMeta;
    if (bisParam === 'aktuell') {
      bisRaeume = aktuellerStand(req.project.id);
      bisMeta = { id: null, name: 'Aktueller Stand', typ: null, datum: today() };
    } else {
      const bisId = num(bisParam);
      if (!bisId) throw new ApiError(400, "Parameter 'bis' muss eine Planstand-ID oder 'aktuell' sein");
      const bis = get('SELECT * FROM plan_states WHERE id = ? AND project_id = ?', bisId, req.project.id);
      if (!bis) throw new ApiError(404, "Planstand 'bis' nicht gefunden");
      bisRaeume = snapshotLesen(bis).raeume;
      bisMeta = { id: bis.id, name: bis.name, typ: bis.typ, datum: bis.datum };
    }
    const vonRaeume = snapshotLesen(von).raeume;

    const vonMap = new Map(vonRaeume.map((r) => [r.nummer, r]));
    const bisMap = new Map(bisRaeume.map((r) => [r.nummer, r]));
    const gleich = (a, b) => String(a ?? '') === String(b ?? '');

    const neueRaeume = [];
    const entfalleneRaeume = [];
    const geaenderte = [];
    for (const [nummer, r] of bisMap) {
      if (!vonMap.has(nummer)) neueRaeume.push({ room_id: r.id ?? null, nummer, bezeichnung: r.bezeichnung });
    }
    for (const [nummer, r] of vonMap) {
      if (!bisMap.has(nummer)) entfalleneRaeume.push({ nummer, bezeichnung: r.bezeichnung });
    }
    for (const [nummer, alt] of vonMap) {
      const neu = bisMap.get(nummer);
      if (!neu) continue;
      const aenderungen = [];
      for (const f of DELTA_STAMM_FELDER) {
        if (!gleich(alt[f], neu[f])) {
          aenderungen.push({ gewerk: null, attribut: f, feld: 'stammdatum', von: alt[f] ?? null, nach: neu[f] ?? null });
        }
      }
      const altAttr = new Map((alt.attribute || []).map((a) => [`${a.gewerk}|${a.name}`, a]));
      const neuAttr = new Map((neu.attribute || []).map((a) => [`${a.gewerk}|${a.name}`, a]));
      for (const [key, a] of neuAttr) {
        const vorher = altAttr.get(key);
        if (!vorher) {
          aenderungen.push({ gewerk: a.gewerk, attribut: a.name, feld: 'attribut', von: null, nach: 'neu angelegt' });
          for (const f of ['soll', 'ist']) {
            if (a[f] !== null && a[f] !== undefined && String(a[f]) !== '') {
              aenderungen.push({ gewerk: a.gewerk, attribut: a.name, feld: f, von: null, nach: a[f] });
            }
          }
          continue;
        }
        for (const f of ['soll', 'ist', 'status']) {
          if (!gleich(vorher[f], a[f])) {
            aenderungen.push({ gewerk: a.gewerk, attribut: a.name, feld: f, von: vorher[f] ?? null, nach: a[f] ?? null });
          }
        }
      }
      for (const [key, a] of altAttr) {
        if (!neuAttr.has(key)) aenderungen.push({ gewerk: a.gewerk, attribut: a.name, feld: 'attribut', von: 'vorhanden', nach: 'entfernt' });
      }
      if (aenderungen.length) {
        geaenderte.push({ raum: { room_id: neu.id ?? null, nummer, bezeichnung: neu.bezeichnung }, aenderungen });
      }
    }
    const nachNummer = (a, b) => String(a.nummer).localeCompare(String(b.nummer), 'de');
    neueRaeume.sort(nachNummer);
    entfalleneRaeume.sort(nachNummer);
    geaenderte.sort((a, b) => String(a.raum.nummer).localeCompare(String(b.raum.nummer), 'de'));

    res.json({
      von: { id: von.id, name: von.name, typ: von.typ, datum: von.datum },
      bis: bisMeta,
      neue_raeume: neueRaeume,
      entfallene_raeume: entfalleneRaeume,
      geaenderte,
    });
  } catch (e) { next(e); }
});

// Planstand-Detail: Metadaten + geparster Snapshot
router.get('/planstaende/:id', requireProject('read', planstandProject), (req, res, next) => {
  try {
    const ps = get(
      `SELECT ps.*, u.display_name AS ersteller FROM plan_states ps
       LEFT JOIN users u ON u.id = ps.created_by WHERE ps.id = ?`, num(req.params.id));
    if (!ps) throw new ApiError(404, 'Planstand nicht gefunden');
    const snapshot = snapshotLesen(ps);
    res.json({
      id: ps.id, project_id: ps.project_id, name: ps.name, typ: ps.typ, datum: ps.datum,
      freigabe_vermerk: ps.freigabe_vermerk, created_at: ps.created_at, ersteller: ps.ersteller,
      snapshot,
    });
  } catch (e) { next(e); }
});

module.exports = router;
