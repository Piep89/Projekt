// NFA-03 – Offline-Erfassung: Ausgangskorb (Outbox) in IndexedDB mit automatischer
// Synchronisation. Strategie „letzte Änderung gewinnt"; Ergebnisse werden protokolliert
// und dem Nutzer angezeigt.
import { toast } from './ui.js';

const DB_NAME = 'ggp-offline';
const STORE = 'outbox';
const LOG_KEY = 'ggp-sync-protokoll';

function oeffneDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(modus) {
  const db = await oeffneDb();
  return db.transaction(STORE, modus).objectStore(STORE);
}

function warte(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function istOffline() {
  return !navigator.onLine;
}

/**
 * Aktion in den Ausgangskorb legen.
 * typ 'json':   {methode, pfad, body}
 * typ 'journal': {projektId, eintrag, fotos: [{name, type, blob}]} – Eintrag + Fotos in einem Schritt
 * typ 'fotos':  {projektId, felder, fotos: [...]}
 */
export async function merken(aktion) {
  const s = await store('readwrite');
  await warte(s.add({ ...aktion, erfasst: new Date().toISOString() }));
  await zeigeStatus();
  toast('Offline gespeichert – wird bei Verbindung synchronisiert');
}

export async function anzahlOffen() {
  try {
    const s = await store('readonly');
    return await warte(s.count());
  } catch { return 0; }
}

function protokolliere(eintrag) {
  try {
    const log = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    log.unshift({ ...eintrag, zeit: new Date().toISOString() });
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(0, 50)));
  } catch { /* Protokoll ist Komfort */ }
}

export function syncProtokoll() {
  try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; }
}

async function sende(aktion) {
  if (aktion.typ === 'json') {
    const res = await fetch(`/api${aktion.pfad}`, {
      method: aktion.methode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(aktion.body),
    });
    return res;
  }
  if (aktion.typ === 'journal') {
    const res = await fetch(`/api/projects/${aktion.projektId}/journal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aktion.eintrag),
    });
    if (res.ok && (aktion.fotos || []).length) {
      const { id } = await res.clone().json();
      const fd = new FormData();
      for (const f of aktion.fotos) fd.append('fotos', new File([f.blob], f.name, { type: f.type }));
      fd.append('journal_id', String(id));
      await fetch(`/api/projects/${aktion.projektId}/photos`, { method: 'POST', body: fd });
    }
    return res;
  }
  if (aktion.typ === 'fotos') {
    const fd = new FormData();
    for (const f of aktion.fotos) fd.append('fotos', new File([f.blob], f.name, { type: f.type }));
    for (const [k, v] of Object.entries(aktion.felder || {})) fd.append(k, String(v));
    return fetch(`/api/projects/${aktion.projektId}/photos`, { method: 'POST', body: fd });
  }
  throw new Error(`Unbekannter Aktionstyp ${aktion.typ}`);
}

let laeuft = false;
export async function synchronisieren() {
  if (laeuft || istOffline()) return;
  laeuft = true;
  let ok = 0, konflikte = 0;
  try {
    const s = await store('readonly');
    const eintraege = await warte(s.getAll());
    for (const aktion of eintraege) {
      try {
        const res = await sende(aktion);
        if (res.ok) {
          ok++;
          protokolliere({ status: 'übertragen', beschreibung: aktion.beschreibung || aktion.pfad || aktion.typ });
        } else {
          // Fachlicher Konflikt (z. B. zwischenzeitlich geändert/gesperrt): Aktion verwerfen,
          // aber sichtbar protokollieren – „letzte Änderung gewinnt" (NFA-03).
          konflikte++;
          let meldung = `HTTP ${res.status}`;
          try { meldung = (await res.json()).error || meldung; } catch { /* egal */ }
          protokolliere({ status: 'konflikt', beschreibung: aktion.beschreibung || aktion.pfad || aktion.typ, meldung });
        }
        const sw = await store('readwrite');
        await warte(sw.delete(aktion.id));
      } catch {
        // Netz weiterhin weg → im Korb lassen, später erneut
        break;
      }
    }
  } finally {
    laeuft = false;
    await zeigeStatus();
    if (ok || konflikte) {
      toast(`Synchronisiert: ${ok} übertragen${konflikte ? `, ${konflikte} Konflikte (siehe „Mein Tag")` : ''}`, konflikte ? 'fehler' : 'ok');
      window.dispatchEvent(new CustomEvent('ggp-sync-fertig'));
    }
  }
}

// Statusanzeige in der Topbar (wird von app.js eingehängt)
export async function zeigeStatus() {
  const el = document.getElementById('offline-status');
  if (!el) return;
  const offen = await anzahlOffen();
  if (istOffline()) {
    el.textContent = offen ? `⚠ Offline · ${offen} wartend` : '⚠ Offline';
    el.style.display = '';
  } else if (offen) {
    el.textContent = `↻ ${offen} wartend`;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

export function offlineStart() {
  window.addEventListener('online', () => { zeigeStatus(); synchronisieren(); });
  window.addEventListener('offline', zeigeStatus);
  zeigeStatus();
  synchronisieren();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA ist Komfort */ });
  }
}
