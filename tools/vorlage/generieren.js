// Baut server/seed/template.json aus den Teildateien und validiert die Inhalte
const fs = require('fs');
const path = require('path');
const phasen1 = require('./teil1');
const phasen2 = require('./teil2');
const phasen3 = require('./teil3');
const { dokumente, attribute, raumtypen } = require('./teil4');

const GEWERKE = new Set(['PL', 'VG', 'AR', 'MT', 'IT', 'ELT', 'MSR', 'HZG', 'LÜF', 'KÄL', 'SAN', 'StrS', 'AS', 'HYG', 'BS']);
const GERAETE = new Set(['MRT', 'CT', 'Angiographie', 'Hybrid-OP', 'PET-CT', 'Linearbeschleuniger', 'Sonstiges']);

const allePhasen = { ...phasen1, ...phasen2, ...phasen3 };
const vorlage = {
  version: '1.0',
  name: 'Leitfaden Beschaffung und Implementierung medizinischer Großgeräte (07/2026)',
  notes: 'Initiale Mastervorlage gemäß Anforderungsprofil GGP. Inhalte projektspezifisch anpassbar; Pflege über Vorlagenversionen.',
  phasen: [], checkpunkte: [], dokumente: [], attribute: [], raumtypen: [],
};

const fehler = [];
for (let nr = 0; nr <= 14; nr++) {
  const [name, punkte] = allePhasen[nr];
  vorlage.phasen.push({ nr, name });
  punkte.forEach(([text, gewerke, fuehrend, prio, hinweis, geraetetypen], i) => {
    for (const g of gewerke.split(',')) if (!GEWERKE.has(g.trim())) fehler.push(`Phase ${nr}: unbekanntes Gewerk '${g}' in "${text}"`);
    if (!GEWERKE.has(fuehrend)) fehler.push(`Phase ${nr}: unbekanntes führendes Gewerk '${fuehrend}'`);
    if (geraetetypen) for (const t of geraetetypen.split(',')) if (!GERAETE.has(t.trim())) fehler.push(`Phase ${nr}: unbekannter Gerätetyp '${t}'`);
    vorlage.checkpunkte.push({
      phase: nr, nr: `${nr}.${String(i + 1).padStart(2, '0')}`, text, gewerke, fuehrend,
      prio: prio || 'normal', ...(hinweis ? { hinweis } : {}), ...(geraetetypen ? { geraetetypen } : {}),
    });
  });
}

for (const [bereich, [, liste]] of Object.entries(dokumente)) {
  liste.forEach(([titel, gewerk, beschreibung], i) => {
    if (!GEWERKE.has(gewerk)) fehler.push(`Dokument ${bereich}: unbekanntes Gewerk '${gewerk}'`);
    vorlage.dokumente.push({ bereich, nr: `${bereich}.${String(i + 1).padStart(2, '0')}`, titel, gewerk, beschreibung });
  });
}

const attrSet = new Set();
for (const [gewerk, name, datentyp, einheit, auswahl, hilfetext] of attribute) {
  if (!GEWERKE.has(gewerk)) fehler.push(`Attribut: unbekanntes Gewerk '${gewerk}'`);
  attrSet.add(`${gewerk}:${name}`);
  vorlage.attribute.push({
    gewerk, name, datentyp, ...(einheit ? { einheit } : {}),
    ...(auswahl ? { auswahl_optionen: auswahl } : {}), ...(hilfetext ? { hilfetext } : {}),
  });
}

for (const [name, refs] of raumtypen) {
  const attrs = refs.map((ref) => {
    if (!attrSet.has(ref)) fehler.push(`Raumtyp ${name}: Attribut '${ref}' existiert nicht`);
    const [gewerk, ...rest] = ref.split(':');
    return { gewerk, name: rest.join(':') };
  });
  vorlage.raumtypen.push({ name, attribute: attrs });
}

// Eindeutigkeit der Nummern
const nrSet = new Set(vorlage.checkpunkte.map((c) => c.nr));
if (nrSet.size !== vorlage.checkpunkte.length) fehler.push('Doppelte Checkpunkt-Nummern');

// Gewerke-Abdeckung
const abdeckung = {};
for (const c of vorlage.checkpunkte) for (const g of c.gewerke.split(',')) abdeckung[g.trim()] = (abdeckung[g.trim()] || 0) + 1;

if (fehler.length) { console.error('FEHLER:\n' + fehler.join('\n')); process.exit(1); }

const ziel = path.join(__dirname, '..', '..', 'server', 'seed', 'template.json');
fs.writeFileSync(ziel, JSON.stringify(vorlage, null, 1));
console.log(`Checkpunkte: ${vorlage.checkpunkte.length} (Ziel 281)`);
console.log(`Dokumente:   ${vorlage.dokumente.length} (Ziel 67)`);
console.log(`Attribute:   ${vorlage.attribute.length}, Raumtypen: ${vorlage.raumtypen.length}`);
console.log('Je Phase:', vorlage.phasen.map((p) => `${p.nr}:${vorlage.checkpunkte.filter((c) => c.phase === p.nr).length}`).join(' '));
console.log('Gewerke-Abdeckung:', Object.entries(abdeckung).map(([g, n]) => `${g}:${n}`).join(' '));
