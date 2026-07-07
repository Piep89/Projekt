// Audit-Trail (ROL-06): jede schreibende Aktion an fachlichen Objekten
// wird mit Nutzer und Zeitstempel unveränderlich protokolliert.
const { run } = require('./db');
const { now } = require('./util');

/**
 * @param {object} req Express-Request (req.user gesetzt durch Auth)
 * @param {number|null} projectId
 * @param {string} objectTyp z. B. 'checkpoint'
 * @param {number} objectId
 * @param {string} action z. B. 'status', 'geaendert', 'erstellt'
 * @param {object|string} [details] Änderungsdetails, z. B. {status: {von, nach}}
 */
function audit(req, projectId, objectTyp, objectId, action, details) {
  run(
    `INSERT INTO audit_trail (project_id, object_typ, object_id, action, details, user_id, username, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    projectId ?? null,
    objectTyp,
    objectId,
    action,
    details === undefined ? null : (typeof details === 'string' ? details : JSON.stringify(details)),
    req.user ? req.user.id : null,
    req.user ? req.user.username : 'system',
    now()
  );
}

// Diff zweier Objekte für sprechende Audit-Details
function diff(before, after, fields) {
  const changes = {};
  for (const f of fields) {
    if (after[f] !== undefined && String(after[f] ?? '') !== String(before[f] ?? '')) {
      changes[f] = { von: before[f] ?? null, nach: after[f] };
    }
  }
  return changes;
}

module.exports = { audit, diff };
