// Gemeinsames PDF-Fundament (pdfkit): Kopf/Fußzeile, Gewerk-Chips, Tabellen
const PDFDocument = require('pdfkit');
const { all } = require('../db');

const SEITE = { breite: 595.28, hoehe: 841.89 }; // A4 in pt
const RAND = 50;
const INHALT_BREITE = SEITE.breite - 2 * RAND;
const GRAU = '#666666';
const LINIE = '#cccccc';

function gewerkFarben() {
  return Object.fromEntries(all('SELECT kuerzel, farbe FROM gewerke').map((g) => [g.kuerzel, g.farbe]));
}

function textFarbe(hex) {
  const n = parseInt(String(hex || '#888888').replace('#', ''), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 160 ? '#1a1a1a' : '#ffffff';
}

function neuesDokument() {
  return new PDFDocument({ size: 'A4', margins: { top: RAND, bottom: RAND + 18, left: RAND, right: RAND }, bufferPages: true });
}

function kopf(doc, { titel, projekt, untertitel }) {
  // REP-05: konfigurierbarer Berichtskopf (Kliniklogo-Zeile/Absender)
  const einstellungen = Object.fromEntries(all('SELECT key, value FROM settings').map((s) => [s.key, s.value]));
  const zeile1 = einstellungen.berichtskopf_zeile1 || 'GGP – Großgeräte-Projektabwicklung';
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAU).text(zeile1, RAND, RAND - 20, { continued: Boolean(einstellungen.berichtskopf_zeile2), lineBreak: false });
  if (einstellungen.berichtskopf_zeile2) doc.font('Helvetica').text(`  ·  ${einstellungen.berichtskopf_zeile2}`, { lineBreak: false });
  doc.text('', RAND, RAND - 20 + 10); // Zeilenhöhe abschließen
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#1f4e79').text(titel, RAND, doc.y + 6);
  if (projekt) doc.font('Helvetica').fontSize(11).fillColor('#222222').text(projekt, { width: INHALT_BREITE });
  const datum = new Date().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  doc.font('Helvetica').fontSize(9).fillColor(GRAU).text(`${untertitel ? untertitel + ' · ' : ''}Erstellt am ${datum}`);
  doc.moveTo(RAND, doc.y + 6).lineTo(SEITE.breite - RAND, doc.y + 6).strokeColor(LINIE).stroke();
  doc.y += 14;
  doc.fillColor('#222222');
}

// Seitenzahlen am Ende auf alle Seiten stempeln
function fusszeilen(doc, projektName) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor(GRAU)
      .text(`${projektName ? projektName + ' · ' : ''}Seite ${i - range.start + 1} von ${range.count}`,
        RAND, SEITE.hoehe - RAND + 8, { width: INHALT_BREITE, align: 'right', lineBreak: false });
  }
}

function abschnitt(doc, titel) {
  seitenumbruch(doc, 40);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#1f4e79').text(titel, RAND);
  doc.moveDown(0.25);
  doc.fillColor('#222222');
}

function seitenumbruch(doc, benoetigt) {
  if (doc.y + benoetigt > SEITE.hoehe - RAND - 20) doc.addPage();
}

function gewerkChip(doc, kuerzel, farben, x, y) {
  if (!kuerzel) return 0;
  const farbe = farben[kuerzel] || '#888888';
  doc.font('Helvetica-Bold').fontSize(7);
  const breite = doc.widthOfString(kuerzel) + 8;
  doc.save().roundedRect(x, y, breite, 11, 2).fill(farbe);
  doc.fillColor(textFarbe(farbe)).text(kuerzel, x + 4, y + 2.5, { lineBreak: false });
  doc.restore().fillColor('#222222');
  return breite;
}

// Mehrere Chips ('ELT,MT') nebeneinander
function gewerkChips(doc, csv, farben, x, y, maxBreite) {
  let dx = 0;
  for (const k of String(csv || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (dx + 30 > maxBreite) break;
    dx += gewerkChip(doc, k, farben, x + dx, y) + 3;
  }
}

/**
 * Einfache Tabelle mit Umbruch und Seitenwechsel.
 * spalten: [{label, breite (Anteil 0..1), get(row) -> string, chips?: bool, rot?: (row)=>bool}]
 */
function tabelle(doc, spalten, zeilen, { farben = {}, leerText = 'Keine Einträge.' } = {}) {
  if (!zeilen.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRAU).text(leerText, RAND).fillColor('#222222');
    return;
  }
  const breiten = spalten.map((s) => Math.floor(s.breite * INHALT_BREITE));
  const zelleX = (i) => RAND + breiten.slice(0, i).reduce((a, b) => a + b, 0);

  const kopfzeile = () => {
    seitenumbruch(doc, 30);
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(GRAU);
    spalten.forEach((s, i) => doc.text(s.label.toUpperCase(), zelleX(i) + 2, y, { width: breiten[i] - 6, lineBreak: false }));
    doc.y = y + 12;
    doc.moveTo(RAND, doc.y).lineTo(SEITE.breite - RAND, doc.y).strokeColor(LINIE).stroke();
    doc.y += 3;
    doc.fillColor('#222222');
  };

  kopfzeile();
  doc.font('Helvetica').fontSize(9);
  for (const row of zeilen) {
    const texte = spalten.map((s) => (s.chips ? '' : String(s.get(row) ?? '—')));
    const hoehen = spalten.map((s, i) => s.chips ? 13 : doc.heightOfString(texte[i] || ' ', { width: breiten[i] - 6 }));
    const zeilenHoehe = Math.max(...hoehen, 13) + 5;
    if (doc.y + zeilenHoehe > SEITE.hoehe - RAND - 20) { doc.addPage(); kopfzeile(); doc.font('Helvetica').fontSize(9); }
    const y = doc.y;
    spalten.forEach((s, i) => {
      if (s.chips) {
        gewerkChips(doc, s.get(row), farben, zelleX(i) + 2, y, breiten[i] - 6);
      } else {
        doc.fillColor(s.rot && s.rot(row) ? '#c0392b' : '#222222')
          .text(texte[i], zelleX(i) + 2, y, { width: breiten[i] - 6 });
      }
    });
    doc.fillColor('#222222');
    doc.y = y + zeilenHoehe;
    doc.moveTo(RAND, doc.y - 3).lineTo(SEITE.breite - RAND, doc.y - 3).strokeColor('#eeeeee').stroke();
  }
  doc.moveDown(0.4);
  doc.x = RAND;
}

// Fortschrittsbalken (Fortschritt je Phase im Statusbericht)
function balken(doc, x, y, breite, anteil) {
  doc.save().roundedRect(x, y, breite, 8, 4).fill('#e8edf3');
  if (anteil > 0) doc.roundedRect(x, y, Math.max(8, breite * Math.min(1, anteil)), 8, 4).fill('#1e8a4c');
  doc.restore().fillColor('#222222');
}

function absatz(doc, label, wert) {
  doc.font('Helvetica-Bold').fontSize(9).text(`${label}: `, { continued: true });
  doc.font('Helvetica').text(String(wert ?? '—'));
}

function pdfResponse(res, dateiname, buildFn) {
  const doc = neuesDokument();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(dateiname)}"`);
  doc.pipe(res);
  buildFn(doc);
  doc.end();
}

function pdfBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = neuesDokument();
    const teile = [];
    doc.on('data', (d) => teile.push(d));
    doc.on('end', () => resolve(Buffer.concat(teile)));
    doc.on('error', reject);
    try { buildFn(doc); doc.end(); } catch (e) { reject(e); }
  });
}

module.exports = {
  RAND, INHALT_BREITE, SEITE, neuesDokument, kopf, fusszeilen, abschnitt, seitenumbruch,
  gewerkChip, gewerkChips, tabelle, balken, absatz, pdfResponse, pdfBuffer, gewerkFarben,
};
