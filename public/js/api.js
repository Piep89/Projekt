// Zentraler API-Client: JSON-Fetch mit einheitlicher Fehlerbehandlung
export async function api(path, options = {}) {
  const opts = { headers: {}, ...options };
  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}`, opts);
  if (res.status === 401 && !path.startsWith('/auth')) {
    window.location.hash = '#/login';
    throw new Error('Nicht angemeldet');
  }
  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) data = await res.json();
  if (!res.ok) throw new Error((data && data.error) || `Fehler ${res.status}`);
  return data;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body });
export const patch = (path, body) => api(path, { method: 'PATCH', body });
export const del = (path) => api(path, { method: 'DELETE' });

// Datei-Upload (FormData)
export async function upload(path, formData) {
  return api(path, { method: 'POST', body: formData });
}

// Globaler Zustand: angemeldeter Nutzer + Gewerke-Katalog
export const state = {
  user: null,
  gewerke: [],
  gewerkeMap: {},   // Kürzel -> {kuerzel, name, farbe}
};

export async function loadBase() {
  const me = await get('/auth/me');
  state.user = me.user;
  if (state.user) {
    state.gewerke = await get('/gewerke');
    state.gewerkeMap = Object.fromEntries(state.gewerke.map((g) => [g.kuerzel, g]));
  }
  return state.user;
}
