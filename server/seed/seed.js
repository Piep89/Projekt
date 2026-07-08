#!/usr/bin/env node
// CLI: Grunddaten sicherstellen, Vorlagen laden, optional Demo-Projekt anlegen
//   npm run seed              -> Grunddaten + Vorlage aus template.json
//   npm run seed -- --file x  -> zusätzliche Vorlagendatei als neue Version laden
//   npm run seed:demo         -> zusätzlich ein Demo-Projekt mit Beispieldaten
const path = require('node:path');
const { get, run } = require('../db');
const { now, today } = require('../util');
const { ensureBaseData } = require('./base');
const { loadTemplateFromFile } = require('./template-loader');
const { instantiateProject } = require('../services/instantiate');

function main() {
  ensureBaseData();

  const args = process.argv.slice(2);
  const fileIdx = args.indexOf('--file');
  if (fileIdx >= 0 && args[fileIdx + 1]) {
    const t = loadTemplateFromFile(path.resolve(args[fileIdx + 1]));
    console.log(`Vorlage '${t.name}' (Version ${t.version}) geladen.`);
  }

  if (args.includes('--demo')) createDemo();
  console.log('Seed abgeschlossen.');
}

function createDemo() {
  if (get("SELECT id FROM projects WHERE name = 'Demo: Ersatz MRT 2, Gebäude 4010'")) {
    console.log('Demo-Projekt existiert bereits.');
    return;
  }
  const admin = get("SELECT id FROM users WHERE username = 'admin'");
  const template = get("SELECT * FROM templates WHERE status = 'aktiv' ORDER BY id DESC LIMIT 1");
  if (!admin || !template) throw new Error('Grunddaten fehlen (Admin/Vorlage)');

  const in3Months = new Date(Date.now() + 90 * 86400e3).toISOString().slice(0, 10);
  const in6Months = new Date(Date.now() + 180 * 86400e3).toISOString().slice(0, 10);
  const { projectId, punkte, dokumente } = instantiateProject(template, {
    name: 'Demo: Ersatz MRT 2, Gebäude 4010',
    geraetetyp: 'MRT',
    gebaeude: '4010', ebene: 'EG',
    budget: '3,2 Mio. €',
    beschreibung: 'Demo-Projekt mit Beispieldaten zum Kennenlernen der Software.',
    meilensteine: [
      { name: 'Vergabe', datum: today() },
      { name: 'Baubeginn', datum: in3Months },
      { name: 'Lieferung Großgerät', datum: in6Months },
      { name: 'Abnahme' }, { name: 'Go-Live' },
    ],
  }, admin.id);

  // Beispiel-Kontakte
  const kontakte = [
    ['Dr. Anna Weber', 'Uniklinik', 'Fachplanerin Medizintechnik', 'MT', 'a.weber@klinik.example'],
    ['Jens Maurer', 'Bauabteilung Uniklinik', 'Projektleiter Bau', 'AR', 'j.maurer@klinik.example'],
    ['Elektro Schmidt GmbH', 'Elektro Schmidt GmbH', 'ELT-Fachfirma', 'ELT', 'info@schmidt-elt.example'],
    ['Herstellerservice MedImaging', 'MedImaging AG', 'Herstellervertreter', 'MT', 'service@medimaging.example'],
  ];
  for (const [name, firma, rolle, gewerk, email] of kontakte) {
    run('INSERT INTO contacts (project_id, name, firma, rolle, gewerk, email) VALUES (?, ?, ?, ?, ?, ?)',
      projectId, name, firma, rolle, gewerk, email);
  }

  // Beispiel-Räume mit Attributen aus dem Vorlagenkatalog
  const rooms = [
    ['4010.EG.012', 'MRT-Untersuchungsraum', 'Untersuchung (DIN 13080: 2.1)', 45.5, 3.2, '1', 'keine', 'HF-Kabine, Dämpfung ≥ 90 dB', 'MRT-Untersuchungsraum'],
    ['4010.EG.013', 'Technikraum MRT', 'Technik', 18.0, 3.0, '0', 'keine', null, 'Technikraum'],
    ['4010.EG.014', 'Schaltraum / Bedienraum', 'Bedienung', 12.5, 2.8, '1', 'keine', null, 'Bedienraum'],
  ];
  for (const [nummer, bezeichnung, funktion, flaeche, hoehe, gruppe, strs, hf, raumtyp] of rooms) {
    const rr = run(`INSERT INTO rooms (project_id, nummer, bezeichnung, funktion, flaeche_m2, hoehe_m, raumgruppe, strahlenschutz, hf_anforderung, raumtyp, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      projectId, nummer, bezeichnung, funktion, flaeche, hoehe, gruppe, strs, hf, raumtyp, now());
    const roomId = Number(rr.lastInsertRowid);
    require('../routes/rooms').raumtypVorbelegen(template.id, raumtyp, roomId, 'MRT');
  }

  console.log(`Demo-Projekt angelegt (#${projectId}): ${punkte} Checkpunkte, ${dokumente} Dokumenteinträge, ${rooms.length} Räume.`);
}

main();
