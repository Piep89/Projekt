// App-Einstieg: Hash-Router, Rahmenlayout (Topbar + Projekt-Seitenleiste), Anmeldung
import { api, post, loadBase, state } from './api.js';
import { h, clear, feld, textInput, fehlerToast } from './ui.js';

import { renderPortfolio } from './views/portfolio.js';
import { renderDashboard } from './views/dashboard.js';
import { renderCheckliste } from './views/checkliste.js';
import { renderSetup } from './views/setup.js';
import { renderRaumbuch } from './views/raumbuch.js';
import { renderDokumente } from './views/dokumente.js';
import { renderBesprechungen } from './views/besprechungen.js';
import { renderBesprechung } from './views/besprechung.js';
import { renderJournal } from './views/journal.js';
import { renderMaengel } from './views/maengel.js';
import { renderKontakte } from './views/kontakte.js';
import { renderBerichte } from './views/berichte.js';
import { renderMeinTag } from './views/meintag.js';
import { renderNotizen } from './views/notizen.js';
import { renderSuche } from './views/suche.js';
import { renderAdmin } from './views/admin.js';
import { renderProjektEinstellungen } from './views/projekt-einstellungen.js';

// Routen: Muster mit :parametern; Reihenfolge = Priorität
const ROUTES = [
  { pattern: '/login', render: renderLogin, ohneShell: true },
  { pattern: '/', render: renderPortfolio },
  { pattern: '/aufgaben', render: renderMeinTag },
  { pattern: '/notizen', render: renderNotizen },
  { pattern: '/suche', render: renderSuche },
  { pattern: '/admin', render: renderAdmin },
  { pattern: '/besprechung/:meetingId', render: renderBesprechung, projektAus: 'meeting' },
  { pattern: '/projekt/:projektId', render: renderDashboard },
  { pattern: '/projekt/:projektId/checkliste', render: renderCheckliste },
  { pattern: '/projekt/:projektId/setup', render: renderSetup },
  { pattern: '/projekt/:projektId/raumbuch', render: renderRaumbuch },
  { pattern: '/projekt/:projektId/dokumente', render: renderDokumente },
  { pattern: '/projekt/:projektId/besprechungen', render: renderBesprechungen },
  { pattern: '/projekt/:projektId/journal', render: renderJournal },
  { pattern: '/projekt/:projektId/maengel', render: renderMaengel },
  { pattern: '/projekt/:projektId/kontakte', render: renderKontakte },
  { pattern: '/projekt/:projektId/berichte', render: renderBerichte },
  { pattern: '/projekt/:projektId/einstellungen', render: renderProjektEinstellungen },
];

const PROJEKT_MENUE = [
  ['', 'Dashboard'],
  ['/checkliste', 'Checkliste'],
  ['/setup', 'Setup-Modus'],
  ['/raumbuch', 'Raumbuch'],
  ['/dokumente', 'Dokumente'],
  ['/besprechungen', 'Besprechungen'],
  ['/journal', 'Journal & Fotos'],
  ['/maengel', 'Mängel'],
  ['/kontakte', 'Kontakte'],
  ['/berichte', 'Berichte & Export'],
  ['/einstellungen', 'Einstellungen'],
];

function matchRoute(path) {
  for (const route of ROUTES) {
    const teileMuster = route.pattern.split('/').filter((s, i) => !(i === 0 && s === ''));
    const teilePfad = path.split('/').filter((s, i) => !(i === 0 && s === ''));
    if (route.pattern === '/') {
      if (path === '/' || path === '') return { route, params: {} };
      continue;
    }
    if (teileMuster.length !== teilePfad.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < teileMuster.length; i++) {
      if (teileMuster[i].startsWith(':')) params[teileMuster[i].slice(1)] = decodeURIComponent(teilePfad[i]);
      else if (teileMuster[i] !== teilePfad[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

export function parseHash() {
  const hash = window.location.hash.replace(/^#/, '') || '/';
  const [path, queryStr] = hash.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryStr || ''));
  return { path, query };
}

async function renderApp() {
  const app = document.getElementById('app');
  const { path, query } = parseHash();

  if (!state.user && path !== '/login') {
    window.location.hash = '#/login';
    return;
  }

  const treffer = matchRoute(path) || { route: { pattern: '/', render: renderPortfolio }, params: {} };
  const { route, params } = treffer;

  if (route.ohneShell) {
    clear(app);
    await route.render(app, params, query);
    return;
  }

  // Shell: Topbar + optionale Projekt-Seitenleiste
  clear(app);
  const inhalt = h('main', { class: 'inhalt', id: 'inhalt' });
  const projektId = params.projektId ? Number(params.projektId) : null;

  app.append(renderTopbar(path));
  const haupt = h('div', { class: 'hauptbereich' });
  if (projektId) {
    haupt.append(await renderSeitenleiste(projektId, path));
  }
  haupt.append(inhalt);
  app.append(haupt);

  try {
    await route.render(inhalt, params, query);
  } catch (e) {
    fehlerToast(e);
    inhalt.append(h('div', { class: 'leer-hinweis' }, `Fehler: ${e.message}`));
  }
}

function renderTopbar(pfad) {
  const suchfeld = h('input', { type: 'search', class: 'input suchfeld', placeholder: 'Suche … (Enter)', 'aria-label': 'Volltextsuche' });
  suchfeld.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && suchfeld.value.trim()) {
      window.location.hash = `#/suche?q=${encodeURIComponent(suchfeld.value.trim())}`;
    }
  });
  const nav = [
    ['#/', 'Projekte', pfad === '/'],
    ['#/aufgaben', 'Mein Tag', pfad === '/aufgaben'],
    ['#/notizen', 'Notizen', pfad === '/notizen'],
  ];
  if (state.user && state.user.role === 'admin') nav.push(['#/admin', 'Administration', pfad === '/admin']);
  return h('header', { class: 'topbar' },
    h('a', { class: 'logo', href: '#/' }, 'GGP'),
    h('nav', {}, nav.map(([href, text, aktiv]) => h('a', { href, class: aktiv ? 'aktiv' : '' }, text))),
    h('div', { class: 'spacer' }),
    suchfeld,
    h('span', { class: 'nutzer' }, state.user ? state.user.display_name : ''),
    h('button', {
      class: 'btn-icon', title: 'Abmelden', style: { color: '#dbe6f1' },
      onclick: async () => { await post('/auth/logout'); state.user = null; window.location.hash = '#/login'; },
    }, '⎋'));
}

let projektCache = { id: null, name: '', status: '' };
async function renderSeitenleiste(projektId, pfad) {
  if (projektCache.id !== projektId) {
    try {
      const p = await api(`/projects/${projektId}`);
      projektCache = { id: projektId, name: p.name, status: p.status };
    } catch { projektCache = { id: projektId, name: `Projekt ${projektId}`, status: '' }; }
  }
  const basis = `/projekt/${projektId}`;
  return h('aside', { class: 'seitenleiste' },
    h('div', { class: 'projekt-name' }, projektCache.name,
      projektCache.status === 'archiviert' ? h('span', { class: 'status-badge status-archiviert', style: { marginLeft: '.4rem' } }, 'Archiviert') : null),
    PROJEKT_MENUE.map(([suffix, text]) => h('a', {
      href: `#${basis}${suffix}`,
      class: pfad === `${basis}${suffix}` ? 'aktiv' : '',
    }, text)),
    h('div', { class: 'trenner' }),
    h('a', { href: '#/' }, '← Alle Projekte'));
}

async function renderLogin(el) {
  const nutzer = textInput({ autocomplete: 'username', name: 'username' });
  const passwort = h('input', { type: 'password', class: 'input', autocomplete: 'current-password', name: 'password' });
  const fehler = h('div', { class: 'muted', style: { color: 'var(--rot)', minHeight: '1.2rem' } });
  const anmelden = async (e) => {
    e.preventDefault();
    try {
      await post('/auth/login', { username: nutzer.value, password: passwort.value });
      await loadBase();
      window.location.hash = '#/';
    } catch (err) {
      fehler.textContent = err.message;
    }
  };
  el.append(h('div', { class: 'login-seite' },
    h('form', { class: 'karte login-karte', onsubmit: anmelden },
      h('div', { class: 'logo-gross' }, 'GGP'),
      h('div', { class: 'untertitel' }, 'Großgeräte-Projektabwicklung'),
      feld('Benutzername', nutzer),
      feld('Passwort', passwort),
      fehler,
      h('button', { class: 'btn btn-primary', type: 'submit', style: { width: '100%', justifyContent: 'center' } }, 'Anmelden'))));
}

// Start
window.addEventListener('hashchange', renderApp);
(async () => {
  try { await loadBase(); } catch (e) { console.error(e); }
  if (!state.user) window.location.hash = '#/login';
  renderApp();
})();
