// GGP – Großgeräte-Projektabwicklung: Server-Einstieg
const express = require('express');
const path = require('node:path');
const { get } = require('./db');
const { ApiError } = require('./util');
const auth = require('./auth');
const { ensureBaseData } = require('./seed/base');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use(auth.sessionMiddleware);

// Grunddaten (Gewerke, Admin-Konto, Vorlage) beim ersten Start anlegen
ensureBaseData();

// API-Routen
app.use('/api', auth.router);
app.use('/api', require('./routes/core'));
app.use('/api', require('./routes/projects'));
app.use('/api', require('./routes/templates'));
app.use('/api', require('./routes/checkpoints'));
app.use('/api', require('./routes/rooms'));
app.use('/api', require('./routes/documents'));
app.use('/api', require('./routes/meetings'));
app.use('/api', require('./routes/tasks'));
app.use('/api', require('./routes/journal'));
app.use('/api', require('./routes/notes'));
app.use('/api', require('./routes/defects'));
app.use('/api', require('./routes/contacts'));
app.use('/api', require('./routes/reports'));

// Statisches Frontend
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Zentrale Fehlerbehandlung: einheitliches {error}-Format
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err instanceof ApiError ? err.status : (err.status || 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Interner Fehler' });
});

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`GGP läuft auf http://localhost:${PORT}`);
    const admin = get("SELECT username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
    if (admin) console.log(`Anmeldung: Benutzer '${admin.username}' (Erstpasswort siehe Konsole beim ersten Start bzw. README)`);
  });
}

module.exports = app;
