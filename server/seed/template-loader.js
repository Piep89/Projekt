// Lädt eine Vorlagendatei (template.json) als neue Vorlagenversion in die Datenbank
const fs = require('node:fs');
const { get, run, tx } = require('../db');
const { now } = require('../util');

function loadTemplateFromFile(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return loadTemplate(data);
}

function loadTemplate(data) {
  if (!data.version || !data.name) throw new Error('Vorlage braucht version und name');
  const existing = get('SELECT id FROM templates WHERE version = ?', String(data.version));
  if (existing) throw new Error(`Vorlagenversion ${data.version} existiert bereits`);
  return tx(() => {
    const r = run('INSERT INTO templates (version, name, status, notes, created_at) VALUES (?, ?, ?, ?, ?)',
      String(data.version), String(data.name), 'aktiv', data.notes || null, now());
    const templateId = Number(r.lastInsertRowid);
    for (const p of data.phasen || []) {
      run('INSERT INTO template_phases (template_id, nr, name, sort_order) VALUES (?, ?, ?, ?)',
        templateId, p.nr, p.name, p.nr);
    }
    for (const c of data.checkpunkte || []) {
      run(`INSERT INTO template_checkpoints (template_id, phase_nr, nr, text, gewerke, fuehrend, prio, hinweis, geraetetypen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        templateId, c.phase, c.nr, c.text, c.gewerke || '', c.fuehrend || null,
        c.prio || 'normal', c.hinweis || null, c.geraetetypen || '');
    }
    for (const d of data.dokumente || []) {
      run('INSERT INTO template_documents (template_id, bereich, nr, titel, gewerk, beschreibung) VALUES (?, ?, ?, ?, ?, ?)',
        templateId, d.bereich, d.nr, d.titel, d.gewerk || null, d.beschreibung || null);
    }
    (data.attribute || []).forEach((a, i) => {
      run(`INSERT INTO template_attributes (template_id, gewerk, name, datentyp, einheit, auswahl_optionen, hilfetext, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        templateId, a.gewerk, a.name, a.datentyp || 'text', a.einheit || null,
        a.auswahl_optionen || null, a.hilfetext || null, i);
    });
    for (const rt of data.raumtypen || []) {
      run('INSERT INTO template_room_types (template_id, name, attribut_namen) VALUES (?, ?, ?)',
        templateId, rt.name, JSON.stringify(rt.attribute || []));
    }
    return { id: templateId, version: data.version, name: data.name };
  });
}

module.exports = { loadTemplate, loadTemplateFromFile };
