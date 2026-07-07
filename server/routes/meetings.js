// M5 – Besprechungen und Protokolle (PRO-01 … PRO-08)
// PRO-07 (E-Mail-Versand) ist bewusst nicht enthalten (kein SMTP in Stufe 1) –
// das Protokoll-PDF kann heruntergeladen und über das Mailsystem der Klinik versandt werden.
const express = require('express');
const { get, all, run, tx } = require('../db');
const { now, today, ApiError } = require('../util');
const { audit, diff } = require('../audit');
const { requireAuth, requireProject, canWriteGewerk } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const TYP_KUERZEL = { planung: 'PB', bau: 'BB', lenkung: 'LK', sonstige: 'SO' };
const STATUS_FOLGE = ['geplant', 'entwurf', 'versandt', 'festgestellt'];

const meetingProjekt = (req) => get('SELECT project_id FROM meetings WHERE id = ?', Number(req.params.id))?.project_id ?? 0;
const punktProjekt = (req) => get('SELECT project_id FROM protocol_items WHERE id = ?', Number(req.params.id))?.project_id ?? 0;

function ladeMeeting(id) {
  const m = get('SELECT * FROM meetings WHERE id = ?', Number(id));
  if (!m) throw new ApiError(404, 'Besprechung nicht gefunden');
  return m;
}

// Offene Punkte früherer Besprechungen derselben Serie (bzw. Projekt+Typ ohne Serie) – PRO-04
function uebernommenePunkte(meeting) {
  const params = [meeting.project_id, meeting.typ, meeting.datum, meeting.id, meeting.id];
  let serienFilter = 'm2.serie_id IS NULL';
  if (meeting.serie_id) { serienFilter = 'm2.serie_id = ?'; params.push(meeting.serie_id); }
  return all(
    `SELECT p.*, k.name AS verantwortlich_name, m2.titel AS meeting_titel, m2.datum AS meeting_datum
     FROM protocol_items p
     JOIN meetings m2 ON m2.id = p.meeting_id
     LEFT JOIN contacts k ON k.id = p.verantwortlich_kontakt_id
     WHERE p.project_id = ? AND p.status = 'offen' AND p.typ_kuerzel = ?
       AND (m2.datum < ? OR (m2.datum = ? AND m2.id < ?)) AND ${serienFilter}
     ORDER BY p.nummer`,
    meeting.project_id, TYP_KUERZEL[meeting.typ], meeting.datum, meeting.datum, meeting.id,
    ...(meeting.serie_id ? [meeting.serie_id] : []));
}

// Aufgabe zu einem Protokollpunkt anlegen (PRO-06)
function erzeugeAufgabe(req, punkt) {
  const r = run(
    `INSERT INTO tasks (project_id, titel, beschreibung, quelle, quelle_id, verantwortlich_kontakt_id, termin, status, created_by, created_at)
     VALUES (?, ?, ?, 'protokoll', ?, ?, ?, 'offen', ?, ?)`,
    punkt.project_id, String(punkt.text).slice(0, 120), `Aus Protokollpunkt ${punkt.code}`,
    punkt.id, punkt.verantwortlich_kontakt_id, punkt.termin, req.user.id, now());
  const taskId = Number(r.lastInsertRowid);
  run('UPDATE protocol_items SET task_id = ? WHERE id = ?', taskId, punkt.id);
  audit(req, punkt.project_id, 'task', taskId, 'erstellt', { aus_protokollpunkt: punkt.code });
  return taskId;
}

// ---------------- Besprechungen ----------------
router.get('/projects/:projectId/meetings', requireProject('read'), (req, res) => {
  res.json(all(
    `SELECT m.*, s.titel AS serie_titel, s.rhythmus AS serie_rhythmus,
       (SELECT COUNT(*) FROM protocol_items p WHERE p.meeting_id = m.id AND p.status = 'offen') AS offene_punkte_anzahl
     FROM meetings m LEFT JOIN meeting_series s ON s.id = m.serie_id
     WHERE m.project_id = ? ORDER BY m.datum DESC, m.id DESC`, req.project.id));
});

router.get('/projects/:projectId/meeting-series', requireProject('read'), (req, res) => {
  res.json(all('SELECT * FROM meeting_series WHERE project_id = ? ORDER BY titel', req.project.id));
});

router.post('/projects/:projectId/meetings', requireProject('write'), (req, res, next) => {
  try {
    const { typ, titel, datum, ort, videolink, teilnehmer, serie } = req.body || {};
    if (!TYP_KUERZEL[typ]) throw new ApiError(400, 'Typ muss planung, bau, lenkung oder sonstige sein');
    if (!titel || !String(titel).trim()) throw new ApiError(400, 'Titel ist Pflicht');
    if (!datum) throw new ApiError(400, 'Datum ist Pflicht');

    const id = tx(() => {
      let serieId = null;
      if (serie && serie.id) {
        const s = get('SELECT * FROM meeting_series WHERE id = ? AND project_id = ?', Number(serie.id), req.project.id);
        if (!s) throw new ApiError(404, 'Serie nicht gefunden');
        if (s.typ !== typ) throw new ApiError(400, 'Typ muss dem Serientyp entsprechen');
        serieId = s.id;
      } else if (serie && serie.titel) {
        const sr = run('INSERT INTO meeting_series (project_id, typ, titel, rhythmus) VALUES (?, ?, ?, ?)',
          req.project.id, typ, String(serie.titel).trim(), serie.rhythmus || null);
        serieId = Number(sr.lastInsertRowid);
      }
      const nrInSerie = serieId
        ? (get('SELECT COALESCE(MAX(nr_in_serie),0) AS m FROM meetings WHERE serie_id = ?', serieId).m) + 1
        : null;
      const r = run(
        `INSERT INTO meetings (project_id, serie_id, typ, nr_in_serie, titel, datum, ort, videolink, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'geplant', ?, ?)`,
        req.project.id, serieId, typ, nrInSerie, String(titel).trim(), datum, ort || null, videolink || null, req.user.id, now());
      const meetingId = Number(r.lastInsertRowid);
      for (const cid of Array.isArray(teilnehmer) ? teilnehmer : []) {
        if (get('SELECT id FROM contacts WHERE id = ? AND project_id = ?', Number(cid), req.project.id)) {
          run('INSERT OR IGNORE INTO meeting_participants (meeting_id, contact_id, status) VALUES (?, ?, ?)', meetingId, Number(cid), 'eingeladen');
        }
      }
      return meetingId;
    });
    audit(req, req.project.id, 'meeting', id, 'erstellt', { titel, typ, datum });
    res.status(201).json({ id });
  } catch (e) { next(e); }
});

// Folgetermin einer Serie (PRO-01): Typ, Ort und Teilnehmer werden übernommen
router.post('/meetings/:id/folgetermin', requireProject('write', meetingProjekt), (req, res, next) => {
  try {
    const m = ladeMeeting(req.params.id);
    const { datum, titel } = req.body || {};
    if (!datum) throw new ApiError(400, 'Datum ist Pflicht');
    const id = tx(() => {
      let serieId = m.serie_id;
      if (!serieId) {
        // Einzeltermin wird durch Folgetermin zur Serie
        const sr = run('INSERT INTO meeting_series (project_id, typ, titel) VALUES (?, ?, ?)', m.project_id, m.typ, m.titel);
        serieId = Number(sr.lastInsertRowid);
        run('UPDATE meetings SET serie_id = ?, nr_in_serie = 1 WHERE id = ?', serieId, m.id);
      }
      const serie = get('SELECT * FROM meeting_series WHERE id = ?', serieId);
      const nr = (get('SELECT COALESCE(MAX(nr_in_serie),0) AS m FROM meetings WHERE serie_id = ?', serieId).m) + 1;
      const r = run(
        `INSERT INTO meetings (project_id, serie_id, typ, nr_in_serie, titel, datum, ort, videolink, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'geplant', ?, ?)`,
        m.project_id, serieId, m.typ, nr, titel || `${serie.titel} Nr. ${nr}`, datum, m.ort, m.videolink, req.user.id, now());
      const neuId = Number(r.lastInsertRowid);
      for (const t of all('SELECT contact_id FROM meeting_participants WHERE meeting_id = ?', m.id)) {
        run('INSERT OR IGNORE INTO meeting_participants (meeting_id, contact_id, status) VALUES (?, ?, ?)', neuId, t.contact_id, 'eingeladen');
      }
      return neuId;
    });
    audit(req, m.project_id, 'meeting', id, 'erstellt', { folgetermin_von: m.titel, datum });
    res.status(201).json({ id });
  } catch (e) { next(e); }
});

router.get('/meetings/:id', requireProject('read', meetingProjekt), (req, res, next) => {
  try {
    const m = ladeMeeting(req.params.id);
    const teilnehmer = all(
      `SELECT mp.contact_id, mp.status, k.name, k.firma, k.rolle, k.gewerk, k.email
       FROM meeting_participants mp JOIN contacts k ON k.id = mp.contact_id
       WHERE mp.meeting_id = ? ORDER BY k.name`, m.id);
    const eigenePunkte = all(
      `SELECT p.*, k.name AS verantwortlich_name,
         (SELECT code FROM protocol_items o WHERE o.id = p.nachtrag_zu) AS nachtrag_zu_code
       FROM protocol_items p LEFT JOIN contacts k ON k.id = p.verantwortlich_kontakt_id
       WHERE p.meeting_id = ? ORDER BY p.nummer`, m.id);
    let agenda = [];
    try { agenda = JSON.parse(m.agenda || '[]'); } catch { agenda = []; }
    res.json({
      ...m,
      agenda,
      serie: m.serie_id ? get('SELECT * FROM meeting_series WHERE id = ?', m.serie_id) : null,
      teilnehmer,
      punkte: eigenePunkte,
      uebernommene_punkte: uebernommenePunkte(m).map((p) => ({
        ...p, uebernommen_aus: { code: p.code, meeting_titel: p.meeting_titel, meeting_datum: p.meeting_datum },
      })),
      projekt_name: req.project.name,
    });
  } catch (e) { next(e); }
});

router.patch('/meetings/:id', requireProject('write', meetingProjekt), (req, res, next) => {
  try {
    const m = ladeMeeting(req.params.id);
    const { titel, datum, ort, videolink, agenda, status } = req.body || {};

    if (status && status !== m.status) {
      const von = STATUS_FOLGE.indexOf(m.status);
      const nach = STATUS_FOLGE.indexOf(status);
      if (nach < 0) throw new ApiError(400, 'Ungültiger Status');
      if (nach < von) throw new ApiError(400, 'Protokollstatus kann nur vorwärts gesetzt werden (Entwurf → Versandt → Festgestellt)');
    }
    const nurStatus = status && titel === undefined && datum === undefined && ort === undefined && videolink === undefined && agenda === undefined;
    if (m.status === 'festgestellt' && !nurStatus) {
      throw new ApiError(403, 'Protokoll ist festgestellt – Änderungen sind nur als Nachtrag möglich');
    }

    const neu = {
      titel: titel ?? m.titel, datum: datum ?? m.datum, ort: ort === undefined ? m.ort : ort,
      videolink: videolink === undefined ? m.videolink : videolink,
      agenda: agenda === undefined ? m.agenda : JSON.stringify(agenda),
      status: status ?? m.status,
    };
    run(`UPDATE meetings SET titel=?, datum=?, ort=?, videolink=?, agenda=?, status=?,
         festgestellt_am = CASE WHEN ? = 'festgestellt' THEN COALESCE(festgestellt_am, ?) ELSE festgestellt_am END
         WHERE id=?`,
      neu.titel, neu.datum, neu.ort, neu.videolink, neu.agenda, neu.status, neu.status, now(), m.id);
    if (status && status !== m.status) {
      audit(req, m.project_id, 'meeting', m.id, 'status', { status: { von: m.status, nach: status } });
    } else {
      audit(req, m.project_id, 'meeting', m.id, 'geaendert', diff(m, neu, ['titel', 'datum', 'ort', 'videolink']));
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- Teilnehmer / Anwesenheit (PRO-08) ----------------
router.put('/meetings/:id/teilnehmer', requireProject('write', meetingProjekt), (req, res, next) => {
  try {
    const m = ladeMeeting(req.params.id);
    const { contact_id, status } = req.body || {};
    if (!['eingeladen', 'anwesend', 'entschuldigt', 'verteiler'].includes(status)) throw new ApiError(400, 'Ungültiger Teilnahmestatus');
    if (!get('SELECT id FROM contacts WHERE id = ? AND project_id = ?', Number(contact_id), m.project_id)) {
      throw new ApiError(404, 'Kontakt nicht gefunden');
    }
    run(`INSERT INTO meeting_participants (meeting_id, contact_id, status) VALUES (?, ?, ?)
         ON CONFLICT(meeting_id, contact_id) DO UPDATE SET status = excluded.status`, m.id, Number(contact_id), status);
    audit(req, m.project_id, 'meeting', m.id, 'teilnehmer', { contact_id: Number(contact_id), status });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/meetings/:id/teilnehmer/:contactId', requireProject('write', meetingProjekt), (req, res, next) => {
  try {
    const m = ladeMeeting(req.params.id);
    run('DELETE FROM meeting_participants WHERE meeting_id = ? AND contact_id = ?', m.id, Number(req.params.contactId));
    audit(req, m.project_id, 'meeting', m.id, 'teilnehmer_entfernt', { contact_id: Number(req.params.contactId) });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- Agenda (PRO-02) ----------------
router.get('/meetings/:id/agenda-vorschlag', requireProject('read', meetingProjekt), (req, res) => {
  const m = ladeMeeting(req.params.id);
  const q = String(req.query.q || '').trim();
  const like = `%${q}%`;
  res.json({
    offene_punkte: uebernommenePunkte(m).map((p) => ({ id: p.id, code: p.code, text: p.text, gewerk: p.gewerk, termin: p.termin })),
    ueberfaellige_aufgaben: all(
      `SELECT id, titel, termin FROM tasks WHERE project_id = ? AND status = 'offen' AND termin IS NOT NULL AND termin < ? ORDER BY termin`,
      m.project_id, today()),
    offene_checkpoints: all(
      `SELECT id, nr, text, gewerke FROM checkpoints
       WHERE project_id = ? AND relevanz != 'nicht_relevant' AND status != 'erledigt'
         AND (nr LIKE ? OR text LIKE ?) ORDER BY nr LIMIT 30`, m.project_id, like, like),
  });
});

router.post('/meetings/:id/agenda-uebernehmen', requireProject('write', meetingProjekt), (req, res, next) => {
  try {
    const m = ladeMeeting(req.params.id);
    if (m.status === 'festgestellt') throw new ApiError(403, 'Protokoll ist festgestellt');
    const { tops } = req.body || {};
    if (!Array.isArray(tops)) throw new ApiError(400, 'tops muss ein Array sein');
    let agenda = [];
    try { agenda = JSON.parse(m.agenda || '[]'); } catch { agenda = []; }
    for (const t of tops) {
      if (t && t.titel) agenda.push({ titel: String(t.titel), quelle_typ: t.quelle_typ || null, quelle_id: t.quelle_id || null });
    }
    run('UPDATE meetings SET agenda = ? WHERE id = ?', JSON.stringify(agenda), m.id);
    audit(req, m.project_id, 'meeting', m.id, 'agenda', { anzahl: tops.length });
    res.json({ agenda });
  } catch (e) { next(e); }
});

// ---------------- Protokollpunkte (PRO-03/05/06) ----------------
function neuerPunkt(req, meeting, { typ, text, gewerk, verantwortlich_kontakt_id, termin, nachtrag_zu }) {
  if (!['information', 'beschluss', 'aufgabe'].includes(typ)) throw new ApiError(400, 'Typ muss information, beschluss oder aufgabe sein');
  if (!text || !String(text).trim()) throw new ApiError(400, 'Text ist Pflicht');
  if (!canWriteGewerk(req.access, gewerk || '')) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');
  if (verantwortlich_kontakt_id && !get('SELECT id FROM contacts WHERE id = ? AND project_id = ?', Number(verantwortlich_kontakt_id), meeting.project_id)) {
    throw new ApiError(400, 'Kontakt gehört nicht zu diesem Projekt');
  }
  const kuerzel = TYP_KUERZEL[meeting.typ];
  return tx(() => {
    const nummer = (get('SELECT COALESCE(MAX(nummer),0) AS m FROM protocol_items WHERE project_id = ? AND typ_kuerzel = ?',
      meeting.project_id, kuerzel).m) + 1;
    const codeStr = `${kuerzel}-${String(nummer).padStart(3, '0')}`;
    const r = run(
      `INSERT INTO protocol_items (project_id, meeting_id, typ_kuerzel, nummer, code, typ, text, gewerk, verantwortlich_kontakt_id, termin, status, nachtrag_zu, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offen', ?, ?)`,
      meeting.project_id, meeting.id, kuerzel, nummer, codeStr, typ, String(text).trim(),
      gewerk || null, verantwortlich_kontakt_id ? Number(verantwortlich_kontakt_id) : null,
      termin || null, nachtrag_zu || null, now());
    const punkt = get('SELECT * FROM protocol_items WHERE id = ?', Number(r.lastInsertRowid));
    if (typ === 'aufgabe') erzeugeAufgabe(req, punkt);
    return punkt;
  });
}

router.post('/meetings/:id/items', requireProject('write', meetingProjekt), (req, res, next) => {
  try {
    const m = ladeMeeting(req.params.id);
    if (m.status === 'festgestellt') throw new ApiError(403, 'Protokoll ist festgestellt – neue Punkte nur als Nachtrag möglich');
    const punkt = neuerPunkt(req, m, req.body || {});
    audit(req, m.project_id, 'protocol_item', punkt.id, 'erstellt', { code: punkt.code, typ: punkt.typ });
    res.status(201).json({ id: punkt.id, code: punkt.code, task_id: punkt.typ === 'aufgabe' ? get('SELECT task_id FROM protocol_items WHERE id = ?', punkt.id).task_id : null });
  } catch (e) { next(e); }
});

router.post('/protocol-items/:id/nachtrag', requireProject('write', punktProjekt), (req, res, next) => {
  try {
    const original = get('SELECT * FROM protocol_items WHERE id = ?', Number(req.params.id));
    if (!original) throw new ApiError(404, 'Protokollpunkt nicht gefunden');
    const meeting = ladeMeeting(original.meeting_id);
    const { text } = req.body || {};
    // Nachtrag ist ausdrücklich AUCH nach Feststellung erlaubt (PRO-05)
    const punkt = neuerPunkt(req, meeting, {
      typ: original.typ, text, gewerk: original.gewerk,
      verantwortlich_kontakt_id: original.verantwortlich_kontakt_id,
      termin: original.termin, nachtrag_zu: original.id,
    });
    audit(req, meeting.project_id, 'protocol_item', punkt.id, 'erstellt', { code: punkt.code, nachtrag_zu: original.code });
    res.status(201).json({ id: punkt.id, code: punkt.code });
  } catch (e) { next(e); }
});

router.patch('/protocol-items/:id', requireProject('write', punktProjekt), (req, res, next) => {
  try {
    const p = get('SELECT * FROM protocol_items WHERE id = ?', Number(req.params.id));
    if (!p) throw new ApiError(404, 'Protokollpunkt nicht gefunden');
    if (!canWriteGewerk(req.access, p.gewerk || '')) throw new ApiError(403, 'Keine Schreibrechte für dieses Gewerk');
    const meeting = ladeMeeting(p.meeting_id);
    const b = req.body || {};

    const inhaltGeaendert = ['text', 'gewerk', 'verantwortlich_kontakt_id', 'termin', 'typ']
      .some((f) => b[f] !== undefined && String(b[f] ?? '') !== String(p[f] ?? ''));
    if (meeting.status === 'festgestellt' && inhaltGeaendert) {
      throw new ApiError(403, 'Protokoll ist festgestellt – inhaltliche Änderungen nur als Nachtrag möglich');
    }
    if (b.status !== undefined && !['offen', 'erledigt'].includes(b.status)) throw new ApiError(400, 'Ungültiger Status');
    if (b.typ !== undefined && !['information', 'beschluss', 'aufgabe'].includes(b.typ)) throw new ApiError(400, 'Ungültiger Typ');
    if (b.verantwortlich_kontakt_id && !get('SELECT id FROM contacts WHERE id = ? AND project_id = ?', Number(b.verantwortlich_kontakt_id), p.project_id)) {
      throw new ApiError(400, 'Kontakt gehört nicht zu diesem Projekt');
    }

    const neu = {
      typ: b.typ ?? p.typ,
      text: b.text !== undefined ? String(b.text).trim() : p.text,
      gewerk: b.gewerk === undefined ? p.gewerk : (b.gewerk || null),
      verantwortlich_kontakt_id: b.verantwortlich_kontakt_id === undefined ? p.verantwortlich_kontakt_id : (b.verantwortlich_kontakt_id ? Number(b.verantwortlich_kontakt_id) : null),
      termin: b.termin === undefined ? p.termin : (b.termin || null),
      status: b.status ?? p.status,
    };
    if (!neu.text) throw new ApiError(400, 'Text darf nicht leer sein');
    const statusWechsel = neu.status !== p.status;

    tx(() => {
      run(`UPDATE protocol_items SET typ=?, text=?, gewerk=?, verantwortlich_kontakt_id=?, termin=?, status=?, erledigt_am=? WHERE id=?`,
        neu.typ, neu.text, neu.gewerk, neu.verantwortlich_kontakt_id, neu.termin, neu.status,
        neu.status === 'erledigt' ? (statusWechsel ? now() : p.erledigt_am) : null, p.id);
      // Typwechsel zu 'aufgabe' ohne bestehende Aufgabe → Aufgabe anlegen
      if (neu.typ === 'aufgabe' && !p.task_id) {
        erzeugeAufgabe(req, get('SELECT * FROM protocol_items WHERE id = ?', p.id));
      }
      // Sync Punkt → Aufgabe (PRO-06), nur bei tatsächlicher Abweichung
      if (statusWechsel && p.task_id) {
        const task = get('SELECT * FROM tasks WHERE id = ?', p.task_id);
        if (task && task.status !== neu.status) {
          run('UPDATE tasks SET status = ?, erledigt_am = ? WHERE id = ?', neu.status, neu.status === 'erledigt' ? now() : null, task.id);
          audit(req, p.project_id, 'task', task.id, 'status', { status: { von: task.status, nach: neu.status }, sync: p.code });
        }
      }
    });

    if (statusWechsel) {
      audit(req, p.project_id, 'protocol_item', p.id, 'status', { status: { von: p.status, nach: neu.status } });
    } else {
      const details = diff(p, neu, ['typ', 'text', 'gewerk', 'verantwortlich_kontakt_id', 'termin']);
      if (Object.keys(details).length) audit(req, p.project_id, 'protocol_item', p.id, 'geaendert', details);
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/protocol-items/:id', requireProject('write', punktProjekt), (req, res, next) => {
  try {
    const p = get('SELECT * FROM protocol_items WHERE id = ?', Number(req.params.id));
    if (!p) throw new ApiError(404, 'Protokollpunkt nicht gefunden');
    const meeting = ladeMeeting(p.meeting_id);
    if (meeting.status === 'festgestellt') throw new ApiError(403, 'Protokoll ist festgestellt – Punkte können nicht mehr gelöscht werden');
    if (get('SELECT id FROM protocol_items WHERE nachtrag_zu = ? LIMIT 1', p.id)) throw new ApiError(400, 'Zu diesem Punkt existiert ein Nachtrag');
    tx(() => {
      if (p.task_id) run('DELETE FROM tasks WHERE id = ?', p.task_id);
      run('DELETE FROM protocol_items WHERE id = ?', p.id);
    });
    audit(req, p.project_id, 'protocol_item', p.id, 'geloescht', { code: p.code });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ---------------- Kalender (INT-04): Besprechungen + Meilensteine als ICS ----------------
router.get('/projects/:projectId/termine.ics', requireProject('read'), (req, res) => {
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const zeilen = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GGP//Projekttermine//DE'];
  for (const m of all('SELECT * FROM meetings WHERE project_id = ?', req.project.id)) {
    const d = String(m.datum).replace(/-/g, '');
    zeilen.push('BEGIN:VEVENT', `UID:ggp-meeting-${m.id}@ggp.local`, `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${esc(m.titel)}`, m.ort ? `LOCATION:${esc(m.ort)}` : null, 'END:VEVENT');
  }
  for (const ms of all('SELECT * FROM milestones WHERE project_id = ? AND datum IS NOT NULL', req.project.id)) {
    const d = String(ms.datum).replace(/-/g, '');
    zeilen.push('BEGIN:VEVENT', `UID:ggp-milestone-${ms.id}@ggp.local`, `DTSTART;VALUE=DATE:${d}`,
      `SUMMARY:${esc('Meilenstein: ' + ms.name)}`, 'END:VEVENT');
  }
  zeilen.push('END:VCALENDAR');
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="ggp-termine.ics"');
  res.send(zeilen.filter(Boolean).join('\r\n'));
});

module.exports = router;
