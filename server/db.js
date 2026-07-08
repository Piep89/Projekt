// Zentraler Datenbankzugriff (node:sqlite, eingebaut in Node >= 22.5)
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.GGP_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.GGP_DB_PATH || path.join(DATA_DIR, 'ggp.sqlite');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// Additive Migrationen für Bestandsdatenbanken: fehlende Spalten ergänzen.
// (CREATE TABLE IF NOT EXISTS greift dort nicht mehr – Werte werden per Default gefüllt.)
function spalteErgaenzen(tabelle, spalte, definition) {
  const vorhanden = db.prepare(`PRAGMA table_info(${tabelle})`).all().some((c) => c.name === spalte);
  if (!vorhanden) db.exec(`ALTER TABLE ${tabelle} ADD COLUMN ${spalte} ${definition}`);
}
// Raumbuch 2.0 (AP-16)
spalteErgaenzen('room_attributes', 'relevanz', "TEXT NOT NULL DEFAULT 'relevant'");
spalteErgaenzen('room_attributes', 'relevanz_begruendung', 'TEXT');
spalteErgaenzen('room_attributes', 'pflicht', 'INTEGER NOT NULL DEFAULT 0');
spalteErgaenzen('room_attributes', 'hilfetext', 'TEXT');
spalteErgaenzen('room_attributes', 'optionen', 'TEXT');
spalteErgaenzen('room_attributes', 'soll_vorschlag', 'TEXT');

// Kleine Helfer über der rohen API
function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}
function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, run, get, all, tx, DATA_DIR, DB_PATH, UPLOAD_DIR };
