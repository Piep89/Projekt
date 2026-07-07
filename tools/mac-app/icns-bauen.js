// Baut eine .icns-Datei aus PNGs (macOS-Icon) – rein in Node, ohne macOS-Werkzeuge.
// Das ICNS-Format erlaubt PNG-Daten direkt in den Chunks ic07/ic08/ic09/ic10.
const fs = require('node:fs');
const path = require('node:path');

const TYPEN = { 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };

function baueIcns(pngVerzeichnis, zielDatei) {
  const chunks = [];
  for (const [groesse, typ] of Object.entries(TYPEN)) {
    const datei = path.join(pngVerzeichnis, `icon-${groesse}.png`);
    if (!fs.existsSync(datei)) continue;
    const png = fs.readFileSync(datei);
    const kopf = Buffer.alloc(8);
    kopf.write(typ, 0, 'ascii');
    kopf.writeUInt32BE(png.length + 8, 4);
    chunks.push(kopf, png);
  }
  if (!chunks.length) throw new Error('Keine PNG-Icons gefunden');
  const inhalt = Buffer.concat(chunks);
  const datei = Buffer.alloc(8);
  datei.write('icns', 0, 'ascii');
  datei.writeUInt32BE(inhalt.length + 8, 4);
  fs.writeFileSync(zielDatei, Buffer.concat([datei, inhalt]));
  console.log(`${zielDatei}: ${inhalt.length + 8} Bytes`);
}

if (require.main === module) {
  baueIcns(path.join(__dirname, 'icons'), process.argv[2] || path.join(__dirname, 'icons', 'ggp.icns'));
}
module.exports = { baueIcns };
