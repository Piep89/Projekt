// Grunddaten beim ersten Start: Gewerke-Katalog, Admin-Konto, Master-Vorlage
const fs = require('node:fs');
const path = require('node:path');
const { get, run, DATA_DIR } = require('../db');
const { now, hashPassword, randomToken } = require('../util');
const { loadTemplateFromFile } = require('./template-loader');

// Die 15 Gewerke gemäß Leitfaden (zentral gepflegt, erweiterbar)
const GEWERKE = [
  ['PL',   'Projektleitung / Projektsteuerung', '#1f4e79'],
  ['VG',   'Vergabe / Einkauf',                 '#6f42c1'],
  ['AR',   'Architektur / Bau',                 '#8a6d3b'],
  ['MT',   'Medizintechnik',                    '#c00000'],
  ['IT',   'Informationstechnik',               '#0d6efd'],
  ['ELT',  'Elektrotechnik',                    '#e8710a'],
  ['MSR',  'Mess-, Steuer- und Regelungstechnik', '#5f6b7a'],
  ['HZG',  'Heizungstechnik',                   '#a0341f'],
  ['LÜF',  'Lüftungs- und Klimatechnik',        '#20a4b8'],
  ['KÄL',  'Kältetechnik',                      '#1274a6'],
  ['SAN',  'Sanitärtechnik / Medizinische Gase', '#1e8a4c'],
  ['StrS', 'Strahlenschutz',                    '#f2c200'],
  ['AS',   'Arbeitssicherheit',                 '#4c6b1f'],
  ['HYG',  'Hygiene',                           '#d63384'],
  ['BS',   'Brandschutz',                       '#e03131'],
];

function ensureBaseData() {
  // Gewerke
  if (!get('SELECT id FROM gewerke LIMIT 1')) {
    GEWERKE.forEach(([kuerzel, name, farbe], i) => {
      run('INSERT INTO gewerke (kuerzel, name, farbe, sort_order) VALUES (?, ?, ?, ?)', kuerzel, name, farbe, i + 1);
    });
  }

  // Admin-Konto: Passwort aus Umgebung oder generiert (wird in data/ abgelegt)
  if (!get('SELECT id FROM users LIMIT 1')) {
    const password = process.env.GGP_ADMIN_PASSWORD || `ggp-${randomToken(6)}`;
    run('INSERT INTO users (username, display_name, email, password_hash, role, note_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      'admin', 'Administrator', null, hashPassword(password), 'admin', randomToken(32), now());
    if (!process.env.GGP_ADMIN_PASSWORD) {
      const file = path.join(DATA_DIR, 'ADMIN-PASSWORT.txt');
      fs.writeFileSync(file, `Erstpasswort für Benutzer 'admin': ${password}\nBitte nach der ersten Anmeldung ändern und diese Datei löschen.\n`);
      console.log(`Admin-Konto angelegt. Erstpasswort: ${password} (auch in ${file})`);
    } else {
      console.log("Admin-Konto angelegt (Passwort aus GGP_ADMIN_PASSWORD).");
    }
  }

  // Master-Vorlage 1.0 aus mitgelieferter Datei
  if (!get('SELECT id FROM templates LIMIT 1')) {
    const file = path.join(__dirname, 'template.json');
    if (fs.existsSync(file)) {
      const t = loadTemplateFromFile(file);
      console.log(`Master-Vorlage '${t.name}' (Version ${t.version}) geladen.`);
    }
  }
}

module.exports = { ensureBaseData, GEWERKE };
