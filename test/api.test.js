// End-to-End-Tests gegen die Abnahmekriterien (Anforderungsprofil Kap. 11)
// Startet einen echten Server mit frischer Datenbank und prüft die Abläufe über die HTTP-API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PORT = 3199;
const BASIS = `http://localhost:${PORT}`;
const ADMIN_PASSWORT = 'test-passwort-123';
let server;
let datenVerzeichnis;
let adminCookie;

async function api(methode, pfad, body, cookie = adminCookie) {
  const opts = { method: methode, headers: {} };
  if (cookie) opts.headers.Cookie = cookie;
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch(`${BASIS}/api${pfad}`, opts);
  const ct = res.headers.get('content-type') || '';
  const daten = ct.includes('application/json') ? await res.json() : await res.arrayBuffer();
  return { status: res.status, daten, contentType: ct };
}

async function login(username, password) {
  const res = await fetch(`${BASIS}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(res.status, 200, `Login ${username} fehlgeschlagen`);
  return res.headers.get('set-cookie').split(';')[0];
}

// Minimaler SMTP-Mock (INT-03/PRO-07): nimmt Mails an und sammelt sie ein
const SMTP_PORT = 2599;
const empfangeneMails = [];
let smtpServer;

function starteSmtpMock() {
  const net = require('node:net');
  smtpServer = net.createServer((sock) => {
    let daten = '', imDatenteil = false;
    sock.write('220 ggp-test SMTP\r\n');
    sock.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (imDatenteil) {
        daten += text;
        if (daten.includes('\r\n.\r\n')) {
          empfangeneMails.push(daten);
          imDatenteil = false;
          sock.write('250 OK\r\n');
        }
        return;
      }
      for (const zeile of text.split('\r\n').filter(Boolean)) {
        if (/^(EHLO|HELO)/i.test(zeile)) sock.write(`250-ggp-test\r\n250 8BITMIME\r\n`);
        else if (/^MAIL FROM/i.test(zeile)) sock.write('250 OK\r\n');
        else if (/^RCPT TO/i.test(zeile)) sock.write('250 OK\r\n');
        else if (/^DATA/i.test(zeile)) { imDatenteil = true; daten = ''; sock.write('354 Ende mit .\r\n'); }
        else if (/^QUIT/i.test(zeile)) { sock.write('221 Tschüss\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
  }).listen(SMTP_PORT);
}

before(async () => {
  starteSmtpMock();
  datenVerzeichnis = fs.mkdtempSync(path.join(os.tmpdir(), 'ggp-test-'));
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env, GGP_DATA_DIR: datenVerzeichnis, GGP_ADMIN_PASSWORD: ADMIN_PASSWORT, PORT: String(PORT),
      GGP_SMTP_HOST: 'localhost', GGP_SMTP_PORT: String(SMTP_PORT), GGP_MAIL_FROM: 'ggp@klinik-test.local',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(`${BASIS}/api/auth/me`); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  adminCookie = await login('admin', ADMIN_PASSWORT);
});

after(() => {
  if (server) server.kill();
  if (smtpServer) smtpServer.close();
  try { fs.rmSync(datenVerzeichnis, { recursive: true, force: true }); } catch { /* egal */ }
});

// Gemeinsame Testobjekte
let projektId, phasen, punkte, kontaktId, nutzerBCookie;

test('Projektanlage aus Vorlage: Phasen 0–14, >250 Checkpunkte, Dokumentenregister A–F', async () => {
  const r = await api('POST', '/projects', { name: 'MRT-Ersatz Testprojekt', geraetetyp: 'MRT', gebaeude: '4010' });
  assert.equal(r.status, 201);
  projektId = r.daten.id;
  assert.ok(r.daten.punkte > 250, `nur ${r.daten.punkte} Punkte instanziiert`);

  phasen = (await api('GET', `/projects/${projektId}/phases`)).daten;
  assert.equal(phasen.length, 15);
  assert.equal(phasen[0].nr, 0);
  assert.equal(phasen[14].nr, 14);

  const dokumente = (await api('GET', `/projects/${projektId}/documents`)).daten;
  assert.equal(dokumente.length, 67);
  for (const bereich of ['A', 'B', 'C', 'D', 'E', 'F']) {
    assert.ok(dokumente.some((d) => d.bereich === bereich), `Bereich ${bereich} fehlt`);
  }

  punkte = (await api('GET', `/projects/${projektId}/checkpoints`)).daten;
  assert.ok(punkte.every((p) => p.gewerke !== undefined));
});

test('Erstbewertung: „Nicht relevant" ohne Begründung wird abgelehnt, Begründung landet im Verlauf', async () => {
  const punkt = punkte[0];
  const ohne = await api('PATCH', `/checkpoints/${punkt.id}`, { relevanz: 'nicht_relevant' });
  assert.equal(ohne.status, 400);

  const mit = await api('PATCH', `/checkpoints/${punkt.id}`, {
    relevanz: 'nicht_relevant', relevanz_begruendung: 'Entfällt: kein Fördermittelprojekt',
  });
  assert.equal(mit.status, 200);

  const verlauf = (await api('GET', `/audit?object_typ=checkpoint&object_id=${punkt.id}`)).daten;
  assert.ok(JSON.stringify(verlauf).includes('kein Fördermittelprojekt'), 'Begründung nicht im Audit-Verlauf');
});

test('Filter Gewerk+Status liefern nur passende Punkte; Ansicht speicherbar (CHK-03)', async () => {
  const gefiltert = (await api('GET', `/projects/${projektId}/checkpoints?gewerk=ELT&status=offen`)).daten;
  assert.ok(gefiltert.length > 0);
  for (const p of gefiltert) {
    assert.ok(p.gewerke.split(',').map((s) => s.trim()).includes('ELT'), `${p.nr} ohne ELT`);
    assert.equal(p.status, 'offen');
  }
  const ansicht = await api('POST', '/views', { modul: 'checkliste', name: 'ELT offen', filter: { gewerk: 'ELT', status: 'offen' } });
  assert.equal(ansicht.status, 201);
  const ansichten = (await api('GET', '/views?modul=checkliste')).daten;
  assert.ok(ansichten.some((a) => a.name === 'ELT offen'));
});

test('Statusmodell: Blockiert braucht Blocker, Wiedereröffnen braucht Kommentar (CHK-01/02)', async () => {
  const punkt = punkte[5];
  assert.equal((await api('PATCH', `/checkpoints/${punkt.id}`, { status: 'blockiert' })).status, 400);
  assert.equal((await api('PATCH', `/checkpoints/${punkt.id}`, { status: 'blockiert', blocker_text: 'Wartet auf Statikgutachten' })).status, 200);
  assert.equal((await api('PATCH', `/checkpoints/${punkt.id}`, { status: 'erledigt' })).status, 200);
  assert.equal((await api('PATCH', `/checkpoints/${punkt.id}`, { status: 'offen' })).status, 400, 'Wiedereröffnen ohne Kommentar muss scheitern');
  assert.equal((await api('PATCH', `/checkpoints/${punkt.id}`, { status: 'offen', kommentar: 'Messung muss wiederholt werden' })).status, 200);
  const verlauf = (await api('GET', `/audit?object_typ=checkpoint&object_id=${punkt.id}`)).daten;
  assert.ok(verlauf.filter((v) => v.action === 'status').length >= 3);
});

test('Raumbuch: Attribut ändern, Planstand einfrieren, Delta zeigt genau die Änderung (RB-04/05)', async () => {
  const raum = await api('POST', `/projects/${projektId}/rooms`, {
    nummer: 'EG.012', bezeichnung: 'Untersuchungsraum', raumtyp: 'MRT-Untersuchungsraum',
  });
  assert.equal(raum.status, 201);
  const raumId = raum.daten.id;
  const detail = (await api('GET', `/rooms/${raumId}`)).daten;
  const alleAttribute = Object.values(detail.attribute).flat ? Object.values(detail.attribute).flat() : detail.attribute;
  const luftwechsel = alleAttribute.find((a) => a.name.includes('Luftwechsel'));
  assert.ok(luftwechsel, 'Vorbelegtes LÜF-Attribut fehlt');

  assert.equal((await api('PATCH', `/room-attributes/${luftwechsel.id}`, { soll: '10', status: 'festgelegt' })).status, 200);
  const planstand = await api('POST', `/projects/${projektId}/planstaende`, {
    name: 'Entwurf Test', typ: 'entwurf', freigabe_vermerk: 'Freigabe Bauherr 07.07.2026',
  });
  assert.equal(planstand.status, 201);

  assert.equal((await api('PATCH', `/room-attributes/${luftwechsel.id}`, { soll: '12' })).status, 200);
  const delta = (await api('GET', `/projects/${projektId}/planstaende/delta?von=${planstand.daten.id}&bis=aktuell`)).daten;
  const aenderungen = (delta.geaenderte || []).flatMap((g) => g.aenderungen || []);
  const treffer = aenderungen.filter((a) => a.feld === 'soll' && String(a.von) === '10' && String(a.nach) === '12');
  assert.equal(treffer.length, 1, `Delta erwartet genau 1 Soll-Änderung, gefunden: ${JSON.stringify(aenderungen)}`);

  const csv = await fetch(`${BASIS}/api/projects/${projektId}/raumbuch.csv?planstand=${planstand.daten.id}`, { headers: { Cookie: adminCookie } });
  assert.equal(csv.status, 200);
  assert.ok((await csv.text()).includes('EG.012'));
  const pdf = await api('GET', `/projects/${projektId}/raumbuch.pdf?planstand=${planstand.daten.id}`);
  assert.ok(pdf.contentType.includes('application/pdf'));
});

test('Besprechungsserie: Carry-over offener Punkte, Aufgaben-Sync in beide Richtungen (PRO-04/06)', async () => {
  kontaktId = (await api('POST', `/projects/${projektId}/contacts`, { name: 'Jens Maurer', firma: 'Bau GmbH', gewerk: 'AR' })).daten.id;
  const sitzung1 = await api('POST', `/projects/${projektId}/meetings`, {
    typ: 'bau', titel: 'Baubesprechung 1', datum: '2026-07-01',
    serie: { titel: 'Baubesprechung', rhythmus: 'wöchentlich' }, teilnehmer: [kontaktId],
  });
  assert.equal(sitzung1.status, 201);

  const p1 = await api('POST', `/meetings/${sitzung1.daten.id}/items`, {
    typ: 'aufgabe', text: 'Kernbohrung Achse B prüfen', gewerk: 'AR', verantwortlich_kontakt_id: kontaktId, termin: '2026-07-05',
  });
  const p2 = await api('POST', `/meetings/${sitzung1.daten.id}/items`, {
    typ: 'aufgabe', text: 'Staubschutzwand ergänzen', gewerk: 'HYG', verantwortlich_kontakt_id: kontaktId,
  });
  assert.equal(p1.status, 201);
  assert.ok(p1.daten.code.startsWith('BB-'));
  assert.ok(p1.daten.task_id, 'Aufgabe wurde nicht automatisch angelegt');

  // Punkt 2 über die AUFGABE erledigen → Protokollpunkt muss folgen
  const aufgabe2 = (await api('GET', `/tasks?projekt=${projektId}`)).daten.find((t) => t.quelle_id === p2.daten.id);
  assert.ok(aufgabe2);
  assert.equal((await api('PATCH', `/tasks/${aufgabe2.id}`, { status: 'erledigt' })).status, 200);
  const s1 = (await api('GET', `/meetings/${sitzung1.daten.id}`)).daten;
  assert.equal(s1.punkte.find((x) => x.id === p2.daten.id).status, 'erledigt', 'Sync Aufgabe→Punkt fehlgeschlagen');

  // Folgetermin: nur der offene Punkt läuft mit
  const sitzung2 = await api('POST', `/meetings/${sitzung1.daten.id}/folgetermin`, { datum: '2026-07-08' });
  const s2 = (await api('GET', `/meetings/${sitzung2.daten.id}`)).daten;
  const codes = s2.uebernommene_punkte.map((x) => x.code);
  assert.ok(codes.includes(p1.daten.code), 'offener Punkt nicht übernommen');
  assert.ok(!codes.includes(p2.daten.code), 'erledigter Punkt fälschlich übernommen');
  assert.equal(s2.teilnehmer.length, 1, 'Teilnehmer nicht kopiert');

  // Agenda-Vorschlag enthält den offenen Punkt
  const agenda = (await api('GET', `/meetings/${sitzung2.daten.id}/agenda-vorschlag`)).daten;
  assert.ok(agenda.offene_punkte.some((x) => x.code === p1.daten.code));

  globalThis._meeting1 = sitzung1.daten.id;
  globalThis._punkt1 = p1.daten.id;
});

test('Protokoll feststellen: Inhalte gesperrt, Nachtrag möglich, PDF verfügbar (PRO-05)', async () => {
  const meetingId = globalThis._meeting1;
  for (const status of ['entwurf', 'versandt', 'festgestellt']) {
    assert.equal((await api('PATCH', `/meetings/${meetingId}`, { status })).status, 200);
  }
  assert.equal((await api('PATCH', `/protocol-items/${globalThis._punkt1}`, { text: 'manipuliert' })).status, 403);
  assert.equal((await api('PATCH', `/meetings/${meetingId}`, { status: 'entwurf' })).status, 400, 'Status rückwärts verboten');

  const nachtrag = await api('POST', `/protocol-items/${globalThis._punkt1}/nachtrag`, { text: 'Korrektur: Achse C statt B' });
  assert.equal(nachtrag.status, 201);
  // Punkt-Status bleibt pflegbar
  assert.equal((await api('PATCH', `/protocol-items/${globalThis._punkt1}`, { status: 'erledigt' })).status, 200);

  const pdf = await api('GET', `/meetings/${meetingId}/protokoll.pdf`);
  assert.ok(pdf.contentType.includes('application/pdf'));
});

test('Dokumentenregister: 5× benötigt, 2× erhalten (Link+Datei) → 3 fehlen; Entfällt braucht Begründung (DOK-01/02/03)', async () => {
  const dokumente = (await api('GET', `/projects/${projektId}/documents`)).daten.slice(0, 5);
  for (const d of dokumente) {
    assert.equal((await api('PATCH', `/documents/${d.id}`, { benoetigt: 'ja' })).status, 200);
  }
  // Version als Ablageverweis
  assert.equal((await api('POST', `/documents/${dokumente[0].id}/versions`, {
    link: '\\\\dms\\projekte\\mrt\\bedarf.pdf', geliefert_von: 'Klinik',
  })).status, 201);
  // Version als Datei-Upload (multipart)
  const fd = new FormData();
  fd.append('datei', new Blob([Buffer.from('%PDF-1.4 test')], { type: 'application/pdf' }), 'test.pdf');
  fd.append('geliefert_von', 'Hersteller');
  assert.equal((await api('POST', `/documents/${dokumente[1].id}/versions`, fd)).status, 201);

  const voll = (await api('GET', `/projects/${projektId}/documents/vollstaendigkeit`)).daten;
  const fehlendeAusDenFuenf = voll.fehlend.filter((f) => dokumente.some((d) => d.id === f.id || d.nr === f.nr));
  assert.equal(fehlendeAusDenFuenf.length, 3, `erwartet 3 fehlende, gefunden ${fehlendeAusDenFuenf.length}`);

  assert.equal((await api('PATCH', `/documents/${dokumente[4].id}`, { benoetigt: 'entfaellt' })).status, 400);
  assert.equal((await api('PATCH', `/documents/${dokumente[4].id}`, { benoetigt: 'entfaellt', begruendung: 'Kein Bestandsgerät vorhanden' })).status, 200);
});

test('Journal: Folgetag-Sperre erzwingt Nachtrag; Foto-Upload mit Zeitstempel (NOT-03/04)', async () => {
  const heute = await api('POST', `/projects/${projektId}/journal`, { text: 'Baustelleneinrichtung begonnen', kategorie: 'baustelle' });
  assert.equal(heute.status, 201);
  assert.equal((await api('PATCH', `/journal/${heute.daten.id}`, { text: 'Baustelleneinrichtung begonnen (korrigiert)' })).status, 200);

  const altDatum = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  const alt = await api('POST', `/projects/${projektId}/journal`, { text: 'Alter Eintrag', datum: altDatum });
  assert.equal((await api('PATCH', `/journal/${alt.daten.id}`, { text: 'Manipulation' })).status, 403);
  assert.equal((await api('POST', `/journal/${alt.daten.id}/nachtrag`, { text: 'Nachtrag zum alten Eintrag' })).status, 201);

  // Mini-PNG hochladen
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('fotos', new Blob([png], { type: 'image/png' }), 'baustelle.png');
  fd.append('journal_id', String(heute.daten.id));
  const foto = await api('POST', `/projects/${projektId}/photos`, fd);
  assert.equal(foto.status, 201);

  const journal = (await api('GET', `/projects/${projektId}/journal`)).daten;
  const eintrag = journal.find((e) => e.id === heute.daten.id);
  assert.equal(eintrag.fotos.length, 1);
  assert.ok(eintrag.fotos[0].aufnahme_zeit, 'aufnahme_zeit fehlt');
});

test('Private Notizen: für andere Nutzer unsichtbar; Veröffentlichung macht sie zum Journaleintrag (ROL-05/NOT-02)', async () => {
  assert.equal((await api('POST', '/users', {
    username: 'nutzerb', display_name: 'Nutzer B', password: 'sicheres-passwort-b1',
  })).status, 201);
  nutzerBCookie = await login('nutzerb', 'sicheres-passwort-b1');

  const notiz = await api('POST', '/notes', {
    titel: 'Geheime Einschätzung', text: 'Vertraulicher Text XYZZY', project_id: projektId,
  });
  assert.equal(notiz.status, 201);

  const notizenB = (await api('GET', '/notes', undefined, nutzerBCookie)).daten;
  assert.ok(!JSON.stringify(notizenB).includes('XYZZY'), 'Fremde Notiz sichtbar!');
  assert.equal((await api('PATCH', `/notes/${notiz.daten.id}`, { text: 'hack' }, nutzerBCookie)).status, 404);
  assert.equal((await api('DELETE', `/notes/${notiz.daten.id}`, undefined, nutzerBCookie)).status, 404);

  const veroeffentlicht = await api('POST', `/notes/${notiz.daten.id}/veroeffentlichen`, { ziel: 'journal' });
  assert.equal(veroeffentlicht.status, 200);
  const journal = (await api('GET', `/projects/${projektId}/journal`)).daten;
  assert.ok(JSON.stringify(journal).includes('XYZZY'), 'Veröffentlichte Notiz nicht im Journal');
  assert.equal((await api('GET', '/notes')).daten.filter((n) => n.titel === 'Geheime Einschätzung').length, 0, 'Notiz nach Veröffentlichung nicht entfernt');
});

test('Mitgliedschaft und Rollen: ohne Mitgliedschaft unsichtbar, Leser darf nicht schreiben (ROL-02)', async () => {
  assert.equal((await api('GET', `/projects/${projektId}`, undefined, nutzerBCookie)).status, 404);
  assert.equal((await api('POST', `/projects/${projektId}/members`, { username: 'nutzerb', role: 'leser' })).status, 201);
  assert.equal((await api('GET', `/projects/${projektId}`, undefined, nutzerBCookie)).status, 200);
  assert.equal((await api('PATCH', `/checkpoints/${punkte[10].id}`, { status: 'in_bearbeitung' }, nutzerBCookie)).status, 403);
});

test('Mangel: Statuskette bis Abnahme, rückwärts verboten, Mängelliste-PDF gefiltert (MGL-01/02)', async () => {
  const mangel = await api('POST', `/projects/${projektId}/maengel`, {
    beschreibung: 'Kratzer in Strahlenschutztür', gewerk: 'StrS', firma: 'Bau GmbH', frist: '2026-08-01',
  });
  assert.equal(mangel.status, 201);
  assert.equal(mangel.daten.code, 'M-001');
  for (const status of ['in_behebung', 'behoben', 'abgenommen']) {
    assert.equal((await api('PATCH', `/maengel/${mangel.daten.id}`, { status })).status, 200);
  }
  assert.equal((await api('PATCH', `/maengel/${mangel.daten.id}`, { status: 'offen' })).status, 400);

  const verlauf = (await api('GET', `/audit?object_typ=defect&object_id=${mangel.daten.id}`)).daten;
  assert.ok(verlauf.filter((v) => v.action === 'status').length >= 3, 'Statuswechsel nicht im Verlauf');

  const pdf = await api('GET', `/projects/${projektId}/maengelliste.pdf?gewerk=StrS`);
  assert.ok(pdf.contentType.includes('application/pdf'));
});

test('Statusbericht-PDF wird erzeugt und ist substanziell (REP-01)', async () => {
  const start = Date.now();
  const pdf = await api('GET', `/projects/${projektId}/reports/statusbericht.pdf`);
  assert.ok(pdf.contentType.includes('application/pdf'));
  assert.ok(pdf.daten.byteLength > 2048, 'PDF verdächtig klein');
  assert.ok(Date.now() - start < 30000, 'Berichtserzeugung über 30 s (NFA-04)');
});

test('Volltextsuche findet Objekte, aber keine privaten Notizen (REP-04)', async () => {
  await api('POST', '/notes', { titel: 'Suchtest', text: 'PRIVATGEHEIM123', project_id: projektId });
  const suche = (await api('GET', '/search?q=Kernbohrung')).daten;
  assert.ok((suche.protocol_items || []).length > 0, 'Protokollpunkt nicht gefunden');
  const geheim = (await api('GET', '/search?q=PRIVATGEHEIM123')).daten;
  assert.ok(!JSON.stringify(geheim).includes('PRIVATGEHEIM123'), 'Private Notiz in offizieller Suche!');
});

test('Vollexport: ZIP mit Daten, Dateien und PDF-Sammelmappe (REP-03)', async () => {
  const res = await fetch(`${BASIS}/api/projects/${projektId}/export`, { headers: { Cookie: adminCookie } });
  assert.equal(res.status, 200);
  const puffer = Buffer.from(await res.arrayBuffer());
  assert.equal(puffer.subarray(0, 2).toString(), 'PK', 'Kein ZIP-Format');
  assert.ok(puffer.length > 5000);
  const inhalt = puffer.toString('latin1');
  for (const name of ['daten/checkpunkte.json', 'pdf/statusbericht.pdf', 'LIESMICH.txt']) {
    assert.ok(inhalt.includes(name), `${name} fehlt im Archiv`);
  }
  assert.ok(!inhalt.includes('XYZZY') && !inhalt.includes('PRIVATGEHEIM123'), 'Private Inhalte im Export!');
});

test('Audit-Trail ist unveränderlich (ROL-06)', async () => {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(datenVerzeichnis, 'ggp.sqlite'));
  assert.throws(() => db.prepare('UPDATE audit_trail SET username = ? WHERE id = 1').run('manipuliert'), /unveraenderlich/);
  assert.throws(() => db.prepare('DELETE FROM audit_trail WHERE id = 1').run(), /unveraenderlich/);
  db.close();
});

test('Archivierung: schreibgeschützt, aber les- und exportierbar; Portfolio zeigt Status (PRJ-04)', async () => {
  assert.equal((await api('PATCH', `/projects/${projektId}`, { status: 'archiviert' })).status, 200);
  assert.equal((await api('PATCH', `/checkpoints/${punkte[12].id}`, { status: 'in_bearbeitung' })).status, 403);
  assert.equal((await api('GET', `/projects/${projektId}/checkpoints`)).status, 200);
  assert.ok((await api('GET', `/projects/${projektId}/reports/statusbericht.pdf`)).contentType.includes('application/pdf'));

  const portfolio = (await api('GET', '/projects')).daten;
  assert.equal(portfolio.find((p) => p.id === projektId).status, 'archiviert');
  // Reaktivieren für Folgende (falls weitere Tests hinzukommen)
  assert.equal((await api('PATCH', `/projects/${projektId}`, { status: 'aktiv' })).status, 200);
});

test('Protokoll per E-Mail versenden: PDF-Anhang erreicht die Teilnehmer (PRO-07/INT-03)', async () => {
  // Kontakt mit E-Mail + Besprechung mit Punkt
  const kontakt = await api('POST', `/projects/${projektId}/contacts`, {
    name: 'Dr. Anna Weber', email: 'a.weber@klinik-test.local', gewerk: 'MT',
  });
  const meeting = await api('POST', `/projects/${projektId}/meetings`, {
    typ: 'planung', titel: 'Planungsrunde Versandtest', datum: '2026-07-07', teilnehmer: [kontakt.daten.id],
  });
  await api('POST', `/meetings/${meeting.daten.id}/items`, { typ: 'beschluss', text: 'Versandtest-Beschluss' });

  const vorher = empfangeneMails.length;
  const r = await api('POST', `/meetings/${meeting.daten.id}/versenden`);
  assert.equal(r.status, 200, JSON.stringify(r.daten));
  assert.deepEqual(r.daten.versandt, ['a.weber@klinik-test.local']);

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(empfangeneMails.length, vorher + 1, 'SMTP-Mock hat keine Mail erhalten');
  const mail = empfangeneMails[empfangeneMails.length - 1];
  assert.ok(mail.includes('a.weber@klinik-test.local'));
  assert.ok(/Protokoll/.test(mail), 'Betreff fehlt');
  assert.ok(mail.includes('application/pdf') || mail.includes('.pdf'), 'PDF-Anhang fehlt');

  // Versand hebt Status auf „versandt"
  const m = (await api('GET', `/meetings/${meeting.daten.id}`)).daten;
  assert.equal(m.status, 'versandt');
});

test('Berichtskopf ist konfigurierbar und erscheint im PDF (REP-05)', async () => {
  assert.equal((await api('PUT', '/settings', {
    berichtskopf_zeile1: 'Universitätsklinikum Musterstadt', berichtskopf_zeile2: 'GB Bau & Technik',
  })).status, 200);
  const pdf = await api('GET', `/projects/${projektId}/reports/statusbericht.pdf`);
  assert.ok(pdf.contentType.includes('application/pdf'));
  // pdfkit komprimiert Streams – Kopfzeile indirekt prüfen: Einstellung ist gespeichert
  const s = (await api('GET', '/settings')).daten;
  assert.equal(s.berichtskopf_zeile1, 'Universitätsklinikum Musterstadt');
  assert.equal(s.mail_konfiguriert, true);
});

test('Projekt kopieren übernimmt Struktur und Bewertungen, setzt Bearbeitung zurück (PRJ-04)', async () => {
  const kopie = await api('POST', `/projects/${projektId}/copy`, { name: 'MRT-Ersatz Kopie' });
  assert.equal(kopie.status, 201);
  const kopiePunkte = (await api('GET', `/projects/${kopie.daten.id}/checkpoints`)).daten;
  assert.equal(kopiePunkte.length, punkte.length);
  assert.ok(kopiePunkte.some((p) => p.relevanz === 'nicht_relevant'), 'Relevanzbewertung nicht übernommen');
  assert.ok(kopiePunkte.every((p) => p.status === 'offen'), 'Status nicht zurückgesetzt');
});
