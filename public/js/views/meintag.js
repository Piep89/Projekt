// Platzhalter – wird durch das Fachmodul ersetzt
import { h } from '../ui.js';

export async function renderMeinTag(el) {
  el.append(h('div', { class: 'leer-hinweis' }, 'Dieses Modul ist noch in Arbeit.'));
}
