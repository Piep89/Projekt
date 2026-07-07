-- GGP – Großgeräte-Projektabwicklung
-- SQLite-Schema (node:sqlite). Alle Zeitstempel als ISO-8601-Text (UTC).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- Nutzer, Sitzungen, Rollen (Kap. 4)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  email         TEXT,
  password_hash TEXT NOT NULL,          -- scrypt: salt:hash (hex)
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  note_key      TEXT NOT NULL,          -- AES-256-GCM-Schlüssel für private Notizen (hex)
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,          -- Zufalls-Token
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- ============================================================
-- Gewerke (zentral, projektübergreifend einheitlich)
-- ============================================================
CREATE TABLE IF NOT EXISTS gewerke (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kuerzel    TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  farbe      TEXT NOT NULL,             -- Hex, z. B. '#c0392b'
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1
);

-- ============================================================
-- Vorlagen (M1: versionierte Master-Vorlage)
-- ============================================================
CREATE TABLE IF NOT EXISTS templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  version    TEXT NOT NULL,             -- z. B. '1.0'
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('entwurf','aktiv','archiviert')),
  notes      TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS template_phases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  nr          INTEGER NOT NULL,         -- 0..14
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS template_checkpoints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  phase_nr    INTEGER NOT NULL,
  nr          TEXT NOT NULL,            -- z. B. '3.07'
  text        TEXT NOT NULL,
  gewerke     TEXT NOT NULL DEFAULT '', -- CSV der Kürzel, z. B. 'ELT,MT'
  fuehrend    TEXT,                     -- federführendes Gewerk (Kürzel)
  prio        TEXT DEFAULT 'normal' CHECK (prio IN ('hoch','normal','niedrig')),
  hinweis     TEXT,                     -- Hilfetext aus dem Leitfaden
  geraetetypen TEXT DEFAULT ''          -- CSV; leer = alle (z. B. 'MRT' für HF-Kabine)
);

CREATE TABLE IF NOT EXISTS template_documents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  bereich     TEXT NOT NULL,            -- 'A'..'F'
  nr          TEXT NOT NULL,            -- z. B. 'B.03'
  titel       TEXT NOT NULL,
  gewerk      TEXT,                     -- Kürzel
  beschreibung TEXT
);

CREATE TABLE IF NOT EXISTS template_attributes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  gewerk      TEXT NOT NULL,            -- Kürzel
  name        TEXT NOT NULL,
  datentyp    TEXT NOT NULL DEFAULT 'text' CHECK (datentyp IN ('zahl','text','auswahl','janein')),
  einheit     TEXT,
  auswahl_optionen TEXT,                -- CSV bei datentyp='auswahl'
  hilfetext   TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS template_room_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,            -- z. B. 'MRT-Untersuchungsraum'
  attribut_namen TEXT NOT NULL DEFAULT '[]'  -- JSON: [{gewerk, name}] → Vorbelegung
);

-- Lessons Learned: Vorschläge für die nächste Vorlagenversion (PRJ-06)
CREATE TABLE IF NOT EXISTS template_suggestions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  project_id  INTEGER,
  typ         TEXT NOT NULL CHECK (typ IN ('neuer_punkt','aenderung','neues_dokument','sonstiges')),
  text        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','uebernommen','verworfen')),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);

-- ============================================================
-- Projekte (M1)
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  geraetetyp   TEXT NOT NULL,           -- MRT/CT/Angio/Hybrid-OP/PET-CT/Linearbeschleuniger/Sonstiges
  gebaeude     TEXT,
  ebene        TEXT,
  budget       TEXT,
  beschreibung TEXT,
  status       TEXT NOT NULL DEFAULT 'aktiv' CHECK (status IN ('aktiv','pausiert','archiviert')),
  template_id  INTEGER REFERENCES templates(id),
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL,
  archived_at  TEXT
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  role       TEXT NOT NULL DEFAULT 'projektleiter' CHECK (role IN ('projektleiter','bearbeiter','leser')),
  gewerke    TEXT,                      -- CSV; NULL/leer = alle Gewerke (nur für 'bearbeiter' relevant)
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS milestones (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,             -- Vergabe, Baubeginn, Lieferung, Abnahme, Go-Live, ...
  datum      TEXT,
  erledigt   INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ============================================================
-- Checkliste (M2)
-- ============================================================
CREATE TABLE IF NOT EXISTS phases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nr         INTEGER NOT NULL,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id    INTEGER NOT NULL REFERENCES phases(id) ON DELETE CASCADE,
  nr          TEXT NOT NULL,
  text        TEXT NOT NULL,
  gewerke     TEXT NOT NULL DEFAULT '',
  fuehrend    TEXT,
  hinweis     TEXT,
  relevanz    TEXT NOT NULL DEFAULT 'unbewertet' CHECK (relevanz IN ('unbewertet','relevant','nicht_relevant')),
  relevanz_begruendung TEXT,            -- Pflicht bei 'nicht_relevant' (CHK-01)
  status      TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_bearbeitung','erledigt','blockiert')),
  blocker_text    TEXT,                 -- Pflicht bei 'blockiert' (alternativ Verweis)
  blocker_ref_typ TEXT,                 -- 'checkpoint' | 'task'
  blocker_ref_id  INTEGER,
  verantwortlich_kontakt_id INTEGER REFERENCES contacts(id),
  termin      TEXT,
  prio        TEXT DEFAULT 'normal' CHECK (prio IN ('hoch','normal','niedrig')),
  is_custom   INTEGER NOT NULL DEFAULT 0,  -- projektspezifischer Zusatzpunkt (CHK-06)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  erledigt_am TEXT
);
CREATE INDEX IF NOT EXISTS idx_checkpoints_project ON checkpoints(project_id, status);

-- ============================================================
-- Raumbuch (M3)
-- ============================================================
CREATE TABLE IF NOT EXISTS rooms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nummer        TEXT NOT NULL,
  bezeichnung   TEXT NOT NULL,
  funktion      TEXT,                   -- DIN 13080
  flaeche_m2    REAL,
  hoehe_m       REAL,
  raumgruppe    TEXT,                   -- DIN VDE 0100-710: 0/1/2
  strahlenschutz TEXT,                  -- Anforderung, z. B. 'Röntgen', 'keine'
  hf_anforderung TEXT,                  -- z. B. 'HF-Kabine 100 dB'
  raumtyp       TEXT,                   -- Referenz auf template_room_types.name
  bemerkung     TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_attributes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  gewerk     TEXT NOT NULL,
  name       TEXT NOT NULL,
  datentyp   TEXT NOT NULL DEFAULT 'text',
  einheit    TEXT,
  soll       TEXT,
  ist        TEXT,
  status     TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','festgelegt','bestaetigt','abweichend')),
  quelle     TEXT,                      -- Quelle/Kommentar (RB-04)
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_room_attr ON room_attributes(room_id, gewerk);

CREATE TABLE IF NOT EXISTS plan_states (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  typ        TEXT NOT NULL CHECK (typ IN ('vorplanung','entwurf','ausfuehrung','as_built','sonstig')),
  datum      TEXT NOT NULL,
  freigabe_vermerk TEXT,
  snapshot   TEXT NOT NULL,             -- JSON: kompletter Raumbuch-Stand
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

-- ============================================================
-- Dokumentenregister (M4)
-- ============================================================
CREATE TABLE IF NOT EXISTS document_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  bereich     TEXT NOT NULL,            -- 'A'..'F'
  nr          TEXT NOT NULL,
  titel       TEXT NOT NULL,
  gewerk      TEXT,
  beschreibung TEXT,
  benoetigt   TEXT NOT NULL DEFAULT 'unbewertet' CHECK (benoetigt IN ('unbewertet','ja','nein','entfaellt')),
  begruendung TEXT,                     -- Pflicht bei 'entfaellt' (DOK-01)
  faelligkeit TEXT,
  verantwortlich_kontakt_id INTEGER REFERENCES contacts(id),  -- Einforderung (DOK-05)
  erhalten_am TEXT,                     -- gesetzt, sobald eine Version vorliegt
  is_custom   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON document_entries(project_id);

CREATE TABLE IF NOT EXISTS document_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id     INTEGER NOT NULL REFERENCES document_entries(id) ON DELETE CASCADE,
  version      TEXT NOT NULL,
  datum        TEXT NOT NULL,
  geliefert_von TEXT,
  attachment_id INTEGER REFERENCES attachments(id),
  link         TEXT,                    -- Ablageverweis statt Upload (DOK-02, INT-06)
  kommentar    TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL
);

-- ============================================================
-- Besprechungen und Protokolle (M5)
-- ============================================================
CREATE TABLE IF NOT EXISTS meeting_series (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  typ        TEXT NOT NULL CHECK (typ IN ('planung','bau','lenkung','sonstige')),
  titel      TEXT NOT NULL,
  rhythmus   TEXT                       -- Freitext, z. B. 'wöchentlich Di 09:00'
);

CREATE TABLE IF NOT EXISTS meetings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  serie_id    INTEGER REFERENCES meeting_series(id),
  typ         TEXT NOT NULL CHECK (typ IN ('planung','bau','lenkung','sonstige')),
  nr_in_serie INTEGER,
  titel       TEXT NOT NULL,
  datum       TEXT NOT NULL,
  ort         TEXT,
  videolink   TEXT,
  agenda      TEXT NOT NULL DEFAULT '[]',  -- JSON: [{titel, quelle_typ, quelle_id}]
  status      TEXT NOT NULL DEFAULT 'geplant' CHECK (status IN ('geplant','entwurf','versandt','festgestellt')),
  festgestellt_am TEXT,
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  contact_id INTEGER NOT NULL REFERENCES contacts(id),
  status     TEXT NOT NULL DEFAULT 'eingeladen' CHECK (status IN ('eingeladen','anwesend','entschuldigt','verteiler')),
  PRIMARY KEY (meeting_id, contact_id)
);

-- Protokollpunkte: projektweit fortlaufende Nummer je Besprechungstyp (PRO-03),
-- offene Punkte erscheinen automatisch in jeder Folgebesprechung der Serie (PRO-04).
CREATE TABLE IF NOT EXISTS protocol_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  meeting_id  INTEGER NOT NULL REFERENCES meetings(id),   -- Ursprungsbesprechung
  typ_kuerzel TEXT NOT NULL,            -- 'PB','BB','LK','SO'
  nummer      INTEGER NOT NULL,
  code        TEXT NOT NULL,            -- z. B. 'PB-014'
  typ         TEXT NOT NULL CHECK (typ IN ('information','beschluss','aufgabe')),
  text        TEXT NOT NULL,
  gewerk      TEXT,
  verantwortlich_kontakt_id INTEGER REFERENCES contacts(id),
  termin      TEXT,
  status      TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','erledigt')),
  task_id     INTEGER REFERENCES tasks(id),  -- bei typ='aufgabe' (PRO-06)
  nachtrag_zu INTEGER REFERENCES protocol_items(id),  -- Nachtrag nach Feststellung (PRO-05)
  created_at  TEXT NOT NULL,
  erledigt_am TEXT,
  UNIQUE (project_id, typ_kuerzel, nummer)
);
CREATE INDEX IF NOT EXISTS idx_protocol_project ON protocol_items(project_id, status);

-- ============================================================
-- Aufgaben (M6)
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = persönlich/projektfrei
  titel        TEXT NOT NULL,
  beschreibung TEXT,
  quelle       TEXT NOT NULL DEFAULT 'frei' CHECK (quelle IN ('frei','protokoll','checkpunkt')),
  quelle_id    INTEGER,                 -- protocol_items.id bzw. checkpoints.id
  verantwortlich_user_id    INTEGER REFERENCES users(id),
  verantwortlich_kontakt_id INTEGER REFERENCES contacts(id),
  termin       TEXT,
  erinnerung   TEXT,
  status       TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','erledigt')),
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL,
  erledigt_am  TEXT
);

-- ============================================================
-- Journal / Bautagebuch (M6) und Fotos
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  datum       TEXT NOT NULL,            -- fachliches Datum (Tag)
  kategorie   TEXT NOT NULL DEFAULT 'baustelle' CHECK (kategorie IN ('baustelle','planung','telefonat','begehung','sonstig')),
  text        TEXT NOT NULL,
  wetter      TEXT,
  anwesende   TEXT,
  nachtrag_zu INTEGER REFERENCES journal_entries(id),  -- NOT-03: Korrektur nur als Nachtrag
  verfasser_id INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  path          TEXT NOT NULL,          -- relativ zu DATA_DIR/uploads
  mime          TEXT,
  size          INTEGER,
  aufnahme_zeit TEXT NOT NULL,          -- NOT-04: automatischer Zeitstempel
  beschreibung  TEXT,
  room_id       INTEGER REFERENCES rooms(id),
  checkpoint_id INTEGER REFERENCES checkpoints(id),
  mangel_id     INTEGER REFERENCES defects(id),
  journal_id    INTEGER REFERENCES journal_entries(id),
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL
);

-- ============================================================
-- Private Notizen (ROL-05): Inhalt AES-256-GCM-verschlüsselt mit Nutzerschlüssel;
-- jeder Zugriff serverseitig strikt auf user_id des Erstellers begrenzt.
-- ============================================================
CREATE TABLE IF NOT EXISTS private_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  titel_enc   TEXT NOT NULL,            -- iv:tag:ciphertext (hex)
  text_enc    TEXT NOT NULL,
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  object_typ  TEXT,                     -- optionaler Objektbezug
  object_id   INTEGER,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- ============================================================
-- Mängel (M7)
-- ============================================================
CREATE TABLE IF NOT EXISTS defects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  nummer       INTEGER NOT NULL,        -- fortlaufend je Projekt: M-001
  beschreibung TEXT NOT NULL,
  room_id      INTEGER REFERENCES rooms(id),
  gewerk       TEXT,
  firma        TEXT,                    -- Verursacher / zuständige Firma
  frist        TEXT,
  status       TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in_behebung','behoben','abgenommen')),
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL,
  UNIQUE (project_id, nummer)
);

-- ============================================================
-- Kontakte (je Projekt) und Verteiler
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  firma      TEXT,
  rolle      TEXT,
  gewerk     TEXT,
  email      TEXT,
  telefon    TEXT,
  notiz      TEXT,
  user_id    INTEGER REFERENCES users(id)   -- optionale Verknüpfung zu einem Login
);

-- ============================================================
-- Querschnitt: Kommentare, Anhänge, Verknüpfungen, Ansichten
-- ============================================================
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  object_typ TEXT NOT NULL,             -- 'checkpoint','room','document','meeting','protocol_item','task','defect','journal'
  object_id  INTEGER NOT NULL,
  user_id    INTEGER REFERENCES users(id),
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_obj ON comments(object_typ, object_id);

CREATE TABLE IF NOT EXISTS attachments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  object_typ TEXT NOT NULL,
  object_id  INTEGER NOT NULL,
  filename   TEXT NOT NULL,
  path       TEXT NOT NULL,
  mime       TEXT,
  size       INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attachments_obj ON attachments(object_typ, object_id);

-- Verknüpfungsprinzip (Kap. 5): beliebige Objekte referenzieren sich gegenseitig
CREATE TABLE IF NOT EXISTS links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  from_typ   TEXT NOT NULL,
  from_id    INTEGER NOT NULL,
  to_typ     TEXT NOT NULL,
  to_id      INTEGER NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (from_typ, from_id, to_typ, to_id)
);
CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_typ, from_id);
CREATE INDEX IF NOT EXISTS idx_links_to   ON links(to_typ, to_id);

-- Gespeicherte persönliche Filteransichten (CHK-03)
CREATE TABLE IF NOT EXISTS saved_views (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id  INTEGER NOT NULL REFERENCES users(id),
  modul    TEXT NOT NULL,               -- 'checkliste','dokumente',...
  name     TEXT NOT NULL,
  filter   TEXT NOT NULL,               -- JSON
  created_at TEXT NOT NULL
);

-- Systemweite Einstellungen (REP-05: Berichtskopf/Absender)
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ============================================================
-- Audit-Trail (ROL-06): append-only, durch Trigger gegen Änderung geschützt
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_trail (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  object_typ TEXT NOT NULL,
  object_id  INTEGER NOT NULL,
  action     TEXT NOT NULL,             -- 'erstellt','geaendert','status','geloescht',...
  details    TEXT,                      -- JSON: {feld: {von, nach}} bzw. Freitext
  user_id    INTEGER,
  username   TEXT,
  timestamp  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_obj ON audit_trail(object_typ, object_id);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_trail(project_id);

CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_trail
BEGIN SELECT RAISE(ABORT, 'Audit-Trail ist unveraenderlich'); END;

CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_trail
BEGIN SELECT RAISE(ABORT, 'Audit-Trail ist unveraenderlich'); END;
