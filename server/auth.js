// Anmeldung, Sitzungen, Rollen und Projektzugriff (Kap. 4)
const express = require('express');
const { get, all, run } = require('./db');
const { now, randomToken, hashPassword, verifyPassword, ApiError, csvList } = require('./util');
const { audit } = require('./audit');

const SESSION_HOURS = 12; // Sitzungs-Timeout (SEC-03)

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

// Hängt req.user an, wenn eine gültige Sitzung vorliegt
function sessionMiddleware(req, res, next) {
  const token = parseCookies(req).ggp_session;
  if (token) {
    const session = get('SELECT * FROM sessions WHERE id = ?', token);
    if (session && session.expires_at > now()) {
      const user = get('SELECT id, username, display_name, email, role, note_key, active FROM users WHERE id = ? AND active = 1', session.user_id);
      if (user) {
        req.user = user;
        // Gleitendes Ablaufdatum
        run('UPDATE sessions SET expires_at = ? WHERE id = ?', new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString(), token);
      }
    } else if (session) {
      run('DELETE FROM sessions WHERE id = ?', token);
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(new ApiError(401, 'Nicht angemeldet'));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(new ApiError(401, 'Nicht angemeldet'));
  if (req.user.role !== 'admin') return next(new ApiError(403, 'Nur für Administratoren'));
  next();
}

// Projektmitgliedschaft (ROL-02): ohne Mitgliedschaft ist ein Projekt unsichtbar.
// Administratoren sehen alle Projekte.
function membership(userId, projectId) {
  return get('SELECT * FROM project_members WHERE project_id = ? AND user_id = ?', projectId, userId);
}

function projectAccess(user, projectId) {
  const project = get('SELECT * FROM projects WHERE id = ?', projectId);
  if (!project) return null;
  if (user.role === 'admin') return { project, memberRole: 'projektleiter', gewerke: null };
  const m = membership(user.id, projectId);
  if (!m) return null;
  return { project, memberRole: m.role, gewerke: m.gewerke ? csvList(m.gewerke) : null };
}

/**
 * Middleware-Fabrik: prüft Projektzugriff und hängt req.project / req.access an.
 * @param {'read'|'write'} mode  'write' verlangt Rolle projektleiter/bearbeiter
 *   und blockiert Schreiben in archivierte Projekte (PRJ-04).
 * @param {(req)=>number} [resolveId]  Ermittlung der Projekt-ID (Standard: req.params.projectId)
 */
function requireProject(mode = 'read', resolveId) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Nicht angemeldet'));
    const projectId = Number(resolveId ? resolveId(req) : req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) return next(new ApiError(400, 'Ungültige Projekt-ID'));
    const access = projectAccess(req.user, projectId);
    if (!access) return next(new ApiError(404, 'Projekt nicht gefunden'));
    if (mode === 'write') {
      if (access.memberRole === 'leser') return next(new ApiError(403, 'Keine Schreibrechte in diesem Projekt'));
      if (access.project.status === 'archiviert') return next(new ApiError(403, 'Projekt ist archiviert (schreibgeschützt)'));
    }
    req.project = access.project;
    req.access = access;
    next();
  };
}

// Gewerke-Einschränkung für Rolle 'bearbeiter' (ROL-03):
// liest das Gesamtprojekt, schreibt nur Objekte seiner Gewerke.
function canWriteGewerk(access, gewerkeCsv) {
  if (!access.gewerke || access.memberRole !== 'bearbeiter') return true;
  const objGewerke = csvList(gewerkeCsv);
  if (objGewerke.length === 0) return true; // Objekte ohne Gewerk sind frei
  return objGewerke.some((g) => access.gewerke.includes(g));
}

// ---------------------------------------------------------------
// Routen
// ---------------------------------------------------------------
const router = express.Router();

router.post('/auth/login', (req, res, next) => {
  const { username, password } = req.body || {};
  const user = get('SELECT * FROM users WHERE username = ? AND active = 1', String(username || ''));
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return next(new ApiError(401, 'Benutzername oder Passwort falsch'));
  }
  const token = randomToken();
  run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    token, user.id, now(), new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString());
  res.setHeader('Set-Cookie', `ggp_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`);
  req.user = { id: user.id, username: user.username };
  audit(req, null, 'user', user.id, 'login'); // SEC-03: sicherheitsrelevante Ereignisse
  res.json({ user: publicUser(user) });
});

router.post('/auth/logout', (req, res) => {
  const token = parseCookies(req).ggp_session;
  if (token) run('DELETE FROM sessions WHERE id = ?', token);
  res.setHeader('Set-Cookie', 'ggp_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: publicUser(req.user) });
});

// Eigenes Passwort ändern (Selbstbedienung, ROL-07 „starke Passwörter")
router.post('/auth/passwort', requireAuth, (req, res, next) => {
  try {
    const { altes_passwort, neues_passwort } = req.body || {};
    const konto = get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(String(altes_passwort || ''), konto.password_hash)) {
      throw new ApiError(400, 'Das bisherige Passwort ist falsch');
    }
    if (String(neues_passwort || '').length < 10) {
      throw new ApiError(400, 'Das neue Passwort muss mindestens 10 Zeichen haben');
    }
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(neues_passwort)), konto.id);
    // Andere Sitzungen beenden, die aktuelle behalten
    const token = parseCookies(req).ggp_session;
    run('DELETE FROM sessions WHERE user_id = ? AND id != ?', konto.id, token || '');
    audit(req, null, 'user', konto.id, 'passwort_geaendert');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

function publicUser(u) {
  return { id: u.id, username: u.username, display_name: u.display_name, email: u.email, role: u.role };
}

// Nutzerverwaltung (nur Admin)
router.get('/users', requireAdmin, (req, res) => {
  res.json(all('SELECT id, username, display_name, email, role, active, created_at FROM users ORDER BY username'));
});

router.post('/users', requireAdmin, (req, res, next) => {
  const { username, display_name, email, password, role } = req.body || {};
  if (!username || !password || !display_name) return next(new ApiError(400, 'username, display_name und password sind Pflicht'));
  if (String(password).length < 10) return next(new ApiError(400, 'Passwort muss mindestens 10 Zeichen haben'));
  if (get('SELECT id FROM users WHERE username = ?', username)) return next(new ApiError(409, 'Benutzername bereits vergeben'));
  const r = run(
    'INSERT INTO users (username, display_name, email, password_hash, role, note_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    String(username), String(display_name), email || null, hashPassword(String(password)),
    role === 'admin' ? 'admin' : 'user', randomToken(32), now()
  );
  audit(req, null, 'user', Number(r.lastInsertRowid), 'erstellt', { username });
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

router.patch('/users/:id', requireAdmin, (req, res, next) => {
  const user = get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
  if (!user) return next(new ApiError(404, 'Nutzer nicht gefunden'));
  const { display_name, email, role, active, password } = req.body || {};
  run('UPDATE users SET display_name = ?, email = ?, role = ?, active = ? WHERE id = ?',
    display_name ?? user.display_name, email ?? user.email,
    role === undefined ? user.role : (role === 'admin' ? 'admin' : 'user'),
    active === undefined ? user.active : (active ? 1 : 0), user.id);
  if (password) {
    if (String(password).length < 10) return next(new ApiError(400, 'Passwort muss mindestens 10 Zeichen haben'));
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(password)), user.id);
    run('DELETE FROM sessions WHERE user_id = ?', user.id);
  }
  audit(req, null, 'user', user.id, 'geaendert', { rechteAenderung: role !== undefined || active !== undefined });
  res.json({ ok: true });
});

module.exports = {
  router, sessionMiddleware, requireAuth, requireAdmin, requireProject,
  projectAccess, canWriteGewerk, publicUser,
};
