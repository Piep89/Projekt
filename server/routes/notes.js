// Private Notizen (ROL-05, NOT-02): Inhalt verschlüsselt, ausschließlich für den Ersteller.
// Jede Abfrage ist strikt auf user_id des angemeldeten Nutzers begrenzt – auch für Administratoren.
const express = require('express');
const { get, all, run } = require('../db');
const { now, today, ApiError, encrypt, decrypt } = require('../util');
const { audit } = require('../audit');
const { requireAuth, projectAccess } = require('../auth');
const { checkObjectAccess } = require('./core');

const router = express.Router();
router.use(requireAuth);

function entschluesseln(req, note) {
  try {
    return {
      id: note.id,
      titel: decrypt(note.titel_enc, req.user.note_key),
      text: decrypt(note.text_enc, req.user.note_key),
      project_id: note.project_id,
      object_typ: note.object_typ,
      object_id: note.object_id,
      created_at: note.created_at,
      updated_at: note.updated_at,
    };
  } catch {
    return null; // defekte/fremde Notiz überspringen
  }
}

function eigeneNotiz(req) {
  const note = get('SELECT * FROM private_notes WHERE id = ? AND user_id = ?', Number(req.params.id), req.user.id);
  if (!note) throw new ApiError(404, 'Notiz nicht gefunden'); // 404 statt 403: Existenz nicht verraten
  return note;
}

router.get('/notes', (req, res) => {
  const { projekt, q } = req.query;
  const rows = projekt
    ? all('SELECT * FROM private_notes WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC', req.user.id, Number(projekt))
    : all('SELECT * FROM private_notes WHERE user_id = ? ORDER BY updated_at DESC', req.user.id);
  let notizen = rows.map((n) => entschluesseln(req, n)).filter(Boolean);
  if (q) {
    const suche = String(q).toLowerCase();
    notizen = notizen.filter((n) => n.titel.toLowerCase().includes(suche) || n.text.toLowerCase().includes(suche));
  }
  const projekte = Object.fromEntries(all('SELECT id, name FROM projects').map((p) => [p.id, p.name]));
  res.json(notizen.map((n) => ({ ...n, projekt_name: n.project_id ? projekte[n.project_id] || null : null })));
});

router.post('/notes', (req, res, next) => {
  try {
    const { titel, text, project_id, object_typ, object_id } = req.body || {};
    if (!titel || !String(titel).trim()) throw new ApiError(400, 'Titel ist Pflicht');
    if (project_id && !projectAccess(req.user, Number(project_id))) throw new ApiError(404, 'Projekt nicht gefunden');
    const r = run(
      `INSERT INTO private_notes (user_id, titel_enc, text_enc, project_id, object_typ, object_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      req.user.id, encrypt(String(titel).trim(), req.user.note_key), encrypt(String(text || ''), req.user.note_key),
      project_id ? Number(project_id) : null, object_typ || null, object_id ? Number(object_id) : null, now(), now());
    // Bewusst KEIN audit: private Inhalte erscheinen in keinem Projektverlauf (ROL-05).
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) { next(e); }
});

router.patch('/notes/:id', (req, res, next) => {
  try {
    const note = eigeneNotiz(req);
    const { titel, text, project_id, object_typ, object_id } = req.body || {};
    run(`UPDATE private_notes SET titel_enc = ?, text_enc = ?, project_id = ?, object_typ = ?, object_id = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      titel !== undefined ? encrypt(String(titel), req.user.note_key) : note.titel_enc,
      text !== undefined ? encrypt(String(text), req.user.note_key) : note.text_enc,
      project_id === undefined ? note.project_id : (project_id ? Number(project_id) : null),
      object_typ === undefined ? note.object_typ : (object_typ || null),
      object_id === undefined ? note.object_id : (object_id ? Number(object_id) : null),
      now(), note.id, req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/notes/:id', (req, res, next) => {
  try {
    const note = eigeneNotiz(req);
    run('DELETE FROM private_notes WHERE id = ? AND user_id = ?', note.id, req.user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// NOT-02: bewusste Veröffentlichung als offizieller Kommentar oder Journaleintrag
router.post('/notes/:id/veroeffentlichen', (req, res, next) => {
  try {
    const note = eigeneNotiz(req);
    const inhalt = entschluesseln(req, note);
    if (!inhalt) throw new ApiError(400, 'Notiz kann nicht entschlüsselt werden');
    const ziel = (req.body || {}).ziel;
    const text = inhalt.text ? `${inhalt.titel}\n${inhalt.text}` : inhalt.titel;

    let zielTyp, zielId;
    if (ziel === 'kommentar') {
      if (!note.object_typ || !note.object_id) throw new ApiError(400, 'Für einen Kommentar braucht die Notiz einen Objektbezug');
      const projectId = checkObjectAccess(req, note.object_typ, note.object_id, 'write');
      const r = run('INSERT INTO comments (object_typ, object_id, user_id, text, created_at) VALUES (?, ?, ?, ?, ?)',
        note.object_typ, note.object_id, req.user.id, text, now());
      audit(req, projectId, note.object_typ, note.object_id, 'kommentar', { aus_notiz: true });
      zielTyp = 'kommentar'; zielId = Number(r.lastInsertRowid);
    } else if (ziel === 'journal') {
      if (!note.project_id) throw new ApiError(400, 'Für einen Journaleintrag braucht die Notiz einen Projektbezug');
      const access = projectAccess(req.user, note.project_id);
      if (!access) throw new ApiError(404, 'Projekt nicht gefunden');
      if (access.memberRole === 'leser') throw new ApiError(403, 'Keine Schreibrechte in diesem Projekt');
      if (access.project.status === 'archiviert') throw new ApiError(403, 'Projekt ist archiviert (schreibgeschützt)');
      const r = run(
        `INSERT INTO journal_entries (project_id, datum, kategorie, text, verfasser_id, created_at)
         VALUES (?, ?, 'sonstig', ?, ?, ?)`, note.project_id, today(), text, req.user.id, now());
      audit(req, note.project_id, 'journal', Number(r.lastInsertRowid), 'erstellt', { aus_notiz: true });
      zielTyp = 'journal'; zielId = Number(r.lastInsertRowid);
    } else {
      throw new ApiError(400, "ziel muss 'kommentar' oder 'journal' sein");
    }

    run('DELETE FROM private_notes WHERE id = ? AND user_id = ?', note.id, req.user.id);
    res.json({ ziel_typ: zielTyp, ziel_id: zielId });
  } catch (e) { next(e); }
});

module.exports = router;
