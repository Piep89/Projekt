// M1 – Vorlagenverwaltung (PRJ-05) und Lessons Learned (PRJ-06):
// Vorlagenliste/-detail, Import als neue Version, JSON-Export, Statuspflege,
// Vorlagen-Delta für laufende Projekte sowie Vorschläge für die nächste Vorlagenversion
const express = require('express');
const { get, all, run, tx } = require('../db');
const { now, ApiError, csvList } = require('../util');
const { audit } = require('../audit');
const { requireAuth, requireAdmin, requireProject } = require('../auth');
const { loadTemplate } = require('../seed/template-loader');

const router = express.Router();
router.use(requireAuth);

const VORLAGEN_STATUS = ['entwurf', 'aktiv', 'archiviert'];
const VORSCHLAG_TYPEN = ['neuer_punkt', 'aenderung', 'neues_dokument', 'sonstiges'];
const VORSCHLAG_STATUS = ['offen', 'uebernommen', 'verworfen'];
const ATTRIBUT_DATENTYPEN = ['zahl', 'text', 'auswahl', 'janein'];
const PRIOS = ['hoch', 'normal', 'niedrig'];

// ---------------- Vorlagenliste ----------------
router.get('/templates', (req, res) => {
  res.json(all(
    `SELECT t.*,
       (SELECT COUNT(*) FROM template_checkpoints c WHERE c.template_id = t.id) AS punkte,
       (SELECT COUNT(*) FROM template_documents d WHERE d.template_id = t.id) AS dokumente,
       (SELECT COUNT(*) FROM template_attributes a WHERE a.template_id = t.id) AS attribute,
       (SELECT COUNT(*) FROM projects p WHERE p.template_id = t.id) AS projekte
     FROM templates t ORDER BY t.id DESC`));
});

// ---------------- Vorlagendetail ----------------
function vorlagenDetail(t) {
  return {
    template: t,
    phasen: all('SELECT * FROM template_phases WHERE template_id = ? ORDER BY sort_order, nr', t.id),
    checkpunkte: all('SELECT * FROM template_checkpoints WHERE template_id = ? ORDER BY phase_nr, nr', t.id),
    dokumente: all('SELECT * FROM template_documents WHERE template_id = ? ORDER BY bereich, nr', t.id),
    attribute: all('SELECT * FROM template_attributes WHERE template_id = ? ORDER BY gewerk, sort_order', t.id),
    raumtypen: all('SELECT * FROM template_room_types WHERE template_id = ? ORDER BY name', t.id)
      .map((rt) => {
        let attribute = [];
        try { attribute = JSON.parse(rt.attribut_namen || '[]'); } catch { attribute = []; }
        return { ...rt, attribute };
      }),
  };
}

router.get('/templates/:id', (req, res, next) => {
  try {
    const t = get('SELECT * FROM templates WHERE id = ?', Number(req.params.id));
    if (!t) throw new ApiError(404, 'Vorlage nicht gefunden');
    res.json(vorlagenDetail(t));
  } catch (e) { next(e); }
});

// ---------------- Export als JSON-Datei (Format wie server/seed/template.json) ----------------
router.get('/templates/:id/export', (req, res, next) => {
  try {
    const t = get('SELECT * FROM templates WHERE id = ?', Number(req.params.id));
    if (!t) throw new ApiError(404, 'Vorlage nicht gefunden');
    const d = vorlagenDetail(t);
    const out = {
      version: t.version,
      name: t.name,
      ...(t.notes ? { notes: t.notes } : {}),
      phasen: d.phasen.map((p) => ({ nr: p.nr, name: p.name })),
      checkpunkte: d.checkpunkte.map((c) => ({
        phase: c.phase_nr, nr: c.nr, text: c.text, gewerke: c.gewerke || '',
        fuehrend: c.fuehrend, prio: c.prio || 'normal', hinweis: c.hinweis, geraetetypen: c.geraetetypen || '',
      })),
      dokumente: d.dokumente.map((x) => ({
        bereich: x.bereich, nr: x.nr, titel: x.titel, gewerk: x.gewerk, beschreibung: x.beschreibung,
      })),
      attribute: d.attribute.map((a) => ({
        gewerk: a.gewerk, name: a.name, datentyp: a.datentyp, einheit: a.einheit,
        auswahl_optionen: a.auswahl_optionen, hilfetext: a.hilfetext,
      })),
      raumtypen: d.raumtypen.map((rt) => ({ name: rt.name, attribute: rt.attribute })),
    };
    const dateiname = `ggp-vorlage-${String(t.version).replace(/[^\w.-]+/g, '_')}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${dateiname}"`);
    res.send(JSON.stringify(out, null, 2));
  } catch (e) { next(e); }
});

// ---------------- Import als neue Vorlagenversion (nur Admin, PRJ-05) ----------------
function pruefeVorlagenJson(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(400, 'Vorlagen-JSON (Objekt) erwartet');
  }
  if (!data.version || !data.name) throw new ApiError(400, 'Vorlage braucht version und name');
  for (const feld of ['phasen', 'checkpunkte', 'dokumente', 'attribute', 'raumtypen']) {
    if (data[feld] !== undefined && !Array.isArray(data[feld])) {
      throw new ApiError(400, `Feld '${feld}' muss eine Liste sein`);
    }
  }
  (data.phasen || []).forEach((p, i) => {
    if (!p || p.nr === undefined || p.nr === null || !p.name) throw new ApiError(400, `Phase ${i + 1}: nr und name sind Pflicht`);
  });
  (data.checkpunkte || []).forEach((c, i) => {
    if (!c || c.phase === undefined || c.phase === null || !c.nr || !c.text) {
      throw new ApiError(400, `Checkpunkt ${i + 1}: phase, nr und text sind Pflicht`);
    }
    if (c.prio && !PRIOS.includes(c.prio)) throw new ApiError(400, `Checkpunkt ${c.nr}: prio muss eine von: ${PRIOS.join(', ')} sein`);
  });
  (data.dokumente || []).forEach((d, i) => {
    if (!d || !d.bereich || !d.nr || !d.titel) throw new ApiError(400, `Dokument ${i + 1}: bereich, nr und titel sind Pflicht`);
  });
  (data.attribute || []).forEach((a, i) => {
    if (!a || !a.gewerk || !a.name) throw new ApiError(400, `Attribut ${i + 1}: gewerk und name sind Pflicht`);
    if (a.datentyp && !ATTRIBUT_DATENTYPEN.includes(a.datentyp)) {
      throw new ApiError(400, `Attribut '${a.name}': datentyp muss einer von: ${ATTRIBUT_DATENTYPEN.join(', ')} sein`);
    }
  });
  (data.raumtypen || []).forEach((rt, i) => {
    if (!rt || !rt.name) throw new ApiError(400, `Raumtyp ${i + 1}: name ist Pflicht`);
    if (rt.attribute !== undefined && !Array.isArray(rt.attribute)) throw new ApiError(400, `Raumtyp '${rt.name}': attribute muss eine Liste sein`);
  });
}

router.post('/templates', requireAdmin, (req, res, next) => {
  try {
    const data = req.body;
    pruefeVorlagenJson(data);
    let t;
    try {
      t = loadTemplate(data);
    } catch (e) {
      throw new ApiError(400, e.message || 'Vorlage konnte nicht geladen werden');
    }
    audit(req, null, 'template', t.id, 'erstellt', {
      version: t.version, name: t.name,
      punkte: (data.checkpunkte || []).length, dokumente: (data.dokumente || []).length,
    });
    res.status(201).json(t);
  } catch (e) { next(e); }
});

// ---------------- Status/Notizen pflegen (nur Admin) ----------------
router.patch('/templates/:id', requireAdmin, (req, res, next) => {
  try {
    const t = get('SELECT * FROM templates WHERE id = ?', Number(req.params.id));
    if (!t) throw new ApiError(404, 'Vorlage nicht gefunden');
    const { status, notes } = req.body || {};
    if (status !== undefined && !VORLAGEN_STATUS.includes(status)) {
      throw new ApiError(400, `Status muss einer von: ${VORLAGEN_STATUS.join(', ')} sein`);
    }
    const neu = {
      status: status ?? t.status,
      notes: notes === undefined ? t.notes : (String(notes).trim() || null),
    };
    run('UPDATE templates SET status = ?, notes = ? WHERE id = ?', neu.status, neu.notes, t.id);
    const details = {};
    if (neu.status !== t.status) details.status = { von: t.status, nach: neu.status };
    if (String(neu.notes ?? '') !== String(t.notes ?? '')) details.notes = { von: t.notes, nach: neu.notes };
    audit(req, null, 'template', t.id, neu.status !== t.status ? 'status' : 'geaendert', details);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ============================================================
// Vorlagen-Delta (PRJ-05): neue Punkte/Dokumente einer Vorlagenversion,
// die im laufenden Projekt noch fehlen (Vergleich über die Nummer)
// ============================================================
function deltaZuVorlage(project, t) {
  const punktNrn = new Set(all('SELECT nr FROM checkpoints WHERE project_id = ?', project.id).map((r) => r.nr));
  const dokNrn = new Set(all('SELECT nr FROM document_entries WHERE project_id = ?', project.id).map((r) => r.nr));
  const phasenNamen = Object.fromEntries(
    all('SELECT nr, name FROM template_phases WHERE template_id = ?', t.id).map((p) => [p.nr, p.name]));

  const neuePunkte = all('SELECT * FROM template_checkpoints WHERE template_id = ? ORDER BY phase_nr, nr', t.id)
    .filter((c) => !punktNrn.has(c.nr))
    .filter((c) => {
      const typen = csvList(c.geraetetypen); // Gerätetyp-Filter wie bei der Instanziierung (PRJ-01)
      return typen.length === 0 || typen.includes(project.geraetetyp);
    })
    .map((c) => ({ ...c, phase_name: phasenNamen[c.phase_nr] || `Phase ${c.phase_nr}` }));

  const neueDokumente = all('SELECT * FROM template_documents WHERE template_id = ? ORDER BY bereich, nr', t.id)
    .filter((d) => !dokNrn.has(d.nr));

  return {
    vorlage: { id: t.id, version: t.version, name: t.name, status: t.status },
    neue_punkte: neuePunkte,
    neue_dokumente: neueDokumente,
  };
}

router.get('/projects/:projectId/vorlagen-delta', requireProject('read'), (req, res, next) => {
  try {
    const t = req.query.template_id
      ? get('SELECT * FROM templates WHERE id = ?', Number(req.query.template_id))
      : get("SELECT * FROM templates WHERE status = 'aktiv' ORDER BY id DESC LIMIT 1");
    if (!t) {
      throw new ApiError(404, req.query.template_id ? 'Vorlage nicht gefunden' : 'Keine aktive Vorlage vorhanden');
    }
    res.json(deltaZuVorlage(req.project, t));
  } catch (e) { next(e); }
});

// Ausgewählte neue Punkte/Dokumente einer Vorlage ins Projekt übernehmen (PRJ-05)
router.post('/projects/:projectId/vorlagen-uebernahme', requireProject('write'), (req, res, next) => {
  try {
    const { template_id, checkpoint_ids, dokument_ids } = req.body || {};
    const t = get('SELECT * FROM templates WHERE id = ?', Number(template_id));
    if (!t) throw new ApiError(404, 'Vorlage nicht gefunden');
    const cpIds = Array.isArray(checkpoint_ids) ? checkpoint_ids.map(Number) : [];
    const dokIds = Array.isArray(dokument_ids) ? dokument_ids.map(Number) : [];
    if (!cpIds.length && !dokIds.length) throw new ApiError(400, 'checkpoint_ids oder dokument_ids angeben');

    const project = req.project;
    const result = tx(() => {
      const punktNrn = new Set(all('SELECT nr FROM checkpoints WHERE project_id = ?', project.id).map((r) => r.nr));
      const dokNrn = new Set(all('SELECT nr FROM document_entries WHERE project_id = ?', project.id).map((r) => r.nr));
      let punkte = 0, dokumente = 0, uebersprungen = 0;

      for (const id of cpIds) {
        const c = get('SELECT * FROM template_checkpoints WHERE id = ? AND template_id = ?', id, t.id);
        if (!c) throw new ApiError(400, `Checkpunkt ${id} gehört nicht zur Vorlage ${t.version}`);
        const typen = csvList(c.geraetetypen);
        if (punktNrn.has(c.nr) || (typen.length && !typen.includes(project.geraetetyp))) { uebersprungen++; continue; }

        // Phase über phase_nr matchen, fehlende Phase aus der Vorlage anlegen
        let phase = get('SELECT id FROM phases WHERE project_id = ? AND nr = ?', project.id, c.phase_nr);
        if (!phase) {
          const tp = get('SELECT * FROM template_phases WHERE template_id = ? AND nr = ?', t.id, c.phase_nr);
          const name = tp ? tp.name : `Phase ${c.phase_nr}`;
          const pr = run('INSERT INTO phases (project_id, nr, name, sort_order) VALUES (?, ?, ?, ?)',
            project.id, c.phase_nr, name, tp ? tp.sort_order : c.phase_nr);
          phase = { id: Number(pr.lastInsertRowid) };
          audit(req, project.id, 'project', project.id, 'geaendert',
            { phase_angelegt: { nr: c.phase_nr, name, aus_vorlage: t.version } });
        }

        const r = run(
          `INSERT INTO checkpoints (project_id, phase_id, nr, text, gewerke, fuehrend, hinweis, prio, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          project.id, phase.id, c.nr, c.text, c.gewerke || '', c.fuehrend, c.hinweis, c.prio || 'normal', now(), now());
        punktNrn.add(c.nr);
        audit(req, project.id, 'checkpoint', Number(r.lastInsertRowid), 'erstellt', { aus_vorlage: t.version, nr: c.nr });
        punkte++;
      }

      for (const id of dokIds) {
        const d = get('SELECT * FROM template_documents WHERE id = ? AND template_id = ?', id, t.id);
        if (!d) throw new ApiError(400, `Dokumenteintrag ${id} gehört nicht zur Vorlage ${t.version}`);
        if (dokNrn.has(d.nr)) { uebersprungen++; continue; }
        const r = run(
          'INSERT INTO document_entries (project_id, bereich, nr, titel, gewerk, beschreibung) VALUES (?, ?, ?, ?, ?, ?)',
          project.id, d.bereich, d.nr, d.titel, d.gewerk, d.beschreibung);
        dokNrn.add(d.nr);
        audit(req, project.id, 'document', Number(r.lastInsertRowid), 'erstellt', { aus_vorlage: t.version, nr: d.nr });
        dokumente++;
      }
      return { punkte, dokumente, uebersprungen };
    });
    res.status(201).json(result);
  } catch (e) { next(e); }
});

// ============================================================
// Lessons Learned (PRJ-06): Vorschläge für die nächste Vorlagenversion
// ============================================================
router.get('/projects/:projectId/template-suggestions', requireProject('read'), (req, res) => {
  res.json(all(
    `SELECT s.*, u.display_name AS ersteller_name, t.version AS vorlage_version, t.name AS vorlage_name
     FROM template_suggestions s
     LEFT JOIN users u ON u.id = s.created_by
     JOIN templates t ON t.id = s.template_id
     WHERE s.project_id = ?
     ORDER BY s.created_at DESC, s.id DESC`, req.project.id));
});

router.post('/projects/:projectId/template-suggestions', requireProject('write'), (req, res, next) => {
  try {
    const { typ, text } = req.body || {};
    if (!VORSCHLAG_TYPEN.includes(typ)) throw new ApiError(400, `typ muss einer von: ${VORSCHLAG_TYPEN.join(', ')} sein`);
    if (!text || !String(text).trim()) throw new ApiError(400, 'text ist Pflicht');
    if (!req.project.template_id) throw new ApiError(400, 'Projekt hat keine Vorlage – Vorschlag kann keiner Vorlage zugeordnet werden');
    const r = run(
      `INSERT INTO template_suggestions (template_id, project_id, typ, text, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      req.project.template_id, req.project.id, typ, String(text).trim(), req.user.id, now());
    audit(req, req.project.id, 'template', req.project.template_id, 'vorschlag',
      { vorschlag_id: Number(r.lastInsertRowid), typ, text: String(text).trim().slice(0, 200) });
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) { next(e); }
});

// Alle Vorschläge (nur Admin) – für den Administrationsbereich
router.get('/template-suggestions', requireAdmin, (req, res) => {
  res.json(all(
    `SELECT s.*, p.name AS projekt_name, u.display_name AS ersteller_name,
            t.version AS vorlage_version, t.name AS vorlage_name
     FROM template_suggestions s
     LEFT JOIN projects p ON p.id = s.project_id
     LEFT JOIN users u ON u.id = s.created_by
     JOIN templates t ON t.id = s.template_id
     ORDER BY CASE s.status WHEN 'offen' THEN 0 ELSE 1 END, s.created_at DESC, s.id DESC`));
});

router.patch('/template-suggestions/:id', requireAdmin, (req, res, next) => {
  try {
    const s = get('SELECT * FROM template_suggestions WHERE id = ?', Number(req.params.id));
    if (!s) throw new ApiError(404, 'Vorschlag nicht gefunden');
    const { status } = req.body || {};
    if (!VORSCHLAG_STATUS.includes(status)) throw new ApiError(400, `status muss einer von: ${VORSCHLAG_STATUS.join(', ')} sein`);
    if (status !== s.status) {
      run('UPDATE template_suggestions SET status = ? WHERE id = ?', status, s.id);
      audit(req, s.project_id, 'template', s.template_id, 'vorschlag_status',
        { vorschlag_id: s.id, status: { von: s.status, nach: status } });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
