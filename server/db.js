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
