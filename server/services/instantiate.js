// Projekt-Instanziierung aus einer Vorlage (PRJ-01) – genutzt von Route und Seed
const { all, run, tx } = require('../db');
const { now, csvList } = require('../util');

/**
 * Erzeugt ein Projekt als Instanz einer Vorlage: Phasen, Checkpunkte
 * (Gerätetyp-Filter), Dokumentenregister, Meilensteine, Ersteller-Mitgliedschaft.
 */
function instantiateProject(template, data, userId) {
  return tx(() => {
    const r = run(
      `INSERT INTO projects (name, geraetetyp, gebaeude, ebene, budget, beschreibung, status, template_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'aktiv', ?, ?, ?)`,
      String(data.name).trim(), data.geraetetyp, data.gebaeude || null, data.ebene || null,
      data.budget || null, data.beschreibung || null, template.id, userId, now());
    const projectId = Number(r.lastInsertRowid);
    run('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)', projectId, userId, 'projektleiter');

    const phaseIds = {};
    for (const p of all('SELECT * FROM template_phases WHERE template_id = ? ORDER BY sort_order', template.id)) {
      const pr = run('INSERT INTO phases (project_id, nr, name, sort_order) VALUES (?, ?, ?, ?)',
        projectId, p.nr, p.name, p.sort_order);
      phaseIds[p.nr] = Number(pr.lastInsertRowid);
    }
    let punkte = 0;
    for (const c of all('SELECT * FROM template_checkpoints WHERE template_id = ? ORDER BY phase_nr, nr', template.id)) {
      const typen = csvList(c.geraetetypen);
      if (typen.length && !typen.includes(data.geraetetyp)) continue;
      if (phaseIds[c.phase_nr] === undefined) continue;
      run(`INSERT INTO checkpoints (project_id, phase_id, nr, text, gewerke, fuehrend, hinweis, prio, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        projectId, phaseIds[c.phase_nr], c.nr, c.text, c.gewerke, c.fuehrend, c.hinweis, c.prio || 'normal', now(), now());
      punkte++;
    }

    let dokumente = 0;
    for (const d of all('SELECT * FROM template_documents WHERE template_id = ? ORDER BY bereich, nr', template.id)) {
      run('INSERT INTO document_entries (project_id, bereich, nr, titel, gewerk, beschreibung) VALUES (?, ?, ?, ?, ?, ?)',
        projectId, d.bereich, d.nr, d.titel, d.gewerk, d.beschreibung);
      dokumente++;
    }

    const ms = Array.isArray(data.meilensteine) && data.meilensteine.length
      ? data.meilensteine
      : ['Vergabe', 'Baubeginn', 'Lieferung Großgerät', 'Abnahme', 'Go-Live'].map((n) => ({ name: n }));
    ms.forEach((m, i) => {
      if (m && m.name) run('INSERT INTO milestones (project_id, name, datum, sort_order) VALUES (?, ?, ?, ?)',
        projectId, String(m.name), m.datum || null, i);
    });

    return { projectId, punkte, dokumente };
  });
}

module.exports = { instantiateProject };
