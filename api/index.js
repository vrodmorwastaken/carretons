'use strict';
/**
 * API de Carretons — port de api.php a una funció serverless de Vercel.
 * Mateix contracte que l'original: /api?action=NOM  (GET o POST amb JSON).
 */
const db = require('../lib/db');
const auth = require('../lib/auth');
const { fcmSendToRol } = require('../lib/fcm');

// Accions que els comissaris de pista poden fer sense sessió d'usuari
const PUBLIC_ACTIONS = new Set([
  'login', 'whoami', 'logout',
  'comissariRegistrar', 'comissariHeartbeat', 'comissariStatus', 'comissariGetStatus',
]);

const serverTimeMs = () => Date.now();
const int = (v) => { const n = parseInt(v, 10); return Number.isNaN(n) ? 0 : n; };
const truthy = (v) => !!Number(v);
const nul = (v) => (v === undefined ? null : v);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const RESET_PISTA_SQL =
  `UPDATE estat_cursa SET estat=NULL, penya_id=NULL, sortida_ms=NULL,
   pausa_activa=0, pausa_inici_ms=NULL, pausa_acum_ms=0 WHERE id=1`;

const LIVE_SQL =
  `SELECT ec.*, p.nom as penya_nom
   FROM estat_cursa ec
   LEFT JOIN penyes p ON ec.penya_id=p.id
   WHERE ec.id=1`;

// ─────────────────────────────────────────────────────────────────────────────
// ACCIONS  (cada una rep { data, query, session, req, res } i retorna l'objecte JSON)
// ─────────────────────────────────────────────────────────────────────────────
const actions = {

  // ── PAUSA TÈCNICA ─────────────────────────────────────────────────────────
  async setPausaTecnica({ data }) {
    if (int(data.activa) === 1) {
      await db.query('UPDATE estat_cursa SET pausa_activa=1, pausa_inici_ms=? WHERE id=1', [serverTimeMs()]);
    } else {
      const ec = await db.one('SELECT pausa_inici_ms, pausa_acum_ms FROM estat_cursa WHERE id=1');
      if (ec && ec.pausa_inici_ms) {
        const elapsed = serverTimeMs() - int(ec.pausa_inici_ms);
        await db.query(
          'UPDATE estat_cursa SET pausa_activa=0, pausa_inici_ms=NULL, pausa_acum_ms=? WHERE id=1',
          [int(ec.pausa_acum_ms) + elapsed]);
      } else {
        await db.query('UPDATE estat_cursa SET pausa_activa=0, pausa_inici_ms=NULL WHERE id=1');
      }
    }
    return { success: true };
  },

  // ── COMISSARIS ────────────────────────────────────────────────────────────
  async comissariRegistrar({ data }) {
    await db.query(
      `INSERT INTO comissaris_pista (nom, token, posicio, status, ultima_act)
       VALUES (?, ?, ?, 'espera', NOW())
       ON DUPLICATE KEY UPDATE nom=VALUES(nom), posicio=VALUES(posicio), status='espera', ultima_act=NOW()`,
      [nul(data.nom), nul(data.token), data.posicio ?? '']);
    return { success: true };
  },

  async comissariHeartbeat({ data }) {
    await db.query('UPDATE comissaris_pista SET ultima_act=NOW() WHERE token=?', [nul(data.token)]);
    return { success: true };
  },

  async comissariStatus({ data }) {
    await db.query(
      `UPDATE comissaris_pista
       SET status=?, pausa_ms=?, pausa_acceptada=NULL, missatge=?, ultima_act=NOW()
       WHERE token=?`,
      [nul(data.status), data.pausa_ms ?? null, data.missatge ?? null, nul(data.token)]);

    if (data.status === 'emergencia') {
      const c = await db.one('SELECT nom, posicio FROM comissaris_pista WHERE token=?', [data.token]);
      await db.query('UPDATE estat_cursa SET bloqueig_direccio=1 WHERE id=1');
      await fcmSendToRol('all', '🚨 EMERGÈNCIA', 'Sector: ' + ((c && (c.posicio || c.nom)) || ''));
    }
    if (data.status === 'pausa_sol') {
      const c = await db.one('SELECT nom, posicio FROM comissaris_pista WHERE token=?', [data.token]);
      await fcmSendToRol('direccio', '⏸ Sol·licitud de Pausa',
        `${(c && c.nom) || ''} demana pausa al sector ${(c && c.posicio) || ''}`);
    }
    if (data.status === 'ready') {
      const c = await db.one('SELECT nom FROM comissaris_pista WHERE token=?', [data.token]);
      await fcmSendToRol('direccio', '✅ Comissari Ready',
        `${(c && c.nom) || 'Comissari'} confirma que està preparat`);
    }
    return { success: true };
  },

  async comissariGetStatus({ query }) {
    const token = query.token || '';
    const comData = await db.one('SELECT pausa_acceptada FROM comissaris_pista WHERE token=?', [token]);
    const live = await db.one(LIVE_SQL);
    return {
      pausa_acceptada: comData ? comData.pausa_acceptada : null,
      liveStatus: live,
    };
  },

  async comissarisGetAll() {
    const rows = await db.query(
      `SELECT *,
              (TIMESTAMPDIFF(SECOND, ultima_act, NOW()) < 20) as online,
              IF(TIMESTAMPDIFF(SECOND, ultima_act, NOW()) >= 20, 'offline', status) as status_efectiu
       FROM comissaris_pista
       ORDER BY ultima_act DESC`);
    rows.forEach((r) => { r.status = r.status_efectiu; });
    return rows;
  },

  async comissariPausaResposta({ data }) {
    const acceptada = int(data.acceptada);
    await db.query('UPDATE comissaris_pista SET pausa_acceptada=? WHERE id=?', [acceptada, int(data.comissari_id)]);
    if (acceptada) {
      await db.query('UPDATE estat_cursa SET pausa_activa=1, pausa_inici_ms=? WHERE id=1', [serverTimeMs()]);
      await fcmSendToRol('all', '⏸ Pausa Activada', 'Direcció ha activat la pausa tècnica');
    } else {
      await fcmSendToRol('direccio', '▶ Pausa Rebutjada', 'La pausa ha estat rebutjada per Direcció');
    }
    return { success: true };
  },

  // ── CURSA CORE ────────────────────────────────────────────────────────────
  async launchCarret({ data }) {
    const bloqueig = await db.val('SELECT bloqueig_direccio FROM estat_cursa WHERE id=1');
    if (bloqueig) {
      return { success: false, error: 'La pista està tancada per Direcció de Cursa.' };
    }
    const target = serverTimeMs() + 10000;
    await db.query(
      'UPDATE estat_cursa SET penya_id=?, estat=0, sortida_ms=?, pausa_acum_ms=0, pausa_activa=0 WHERE id=1',
      [nul(data.penya_id), target]);
    return { success: true, targetMs: target, serverMs: serverTimeMs() };
  },

  async clearPista() {
    await db.query(RESET_PISTA_SQL);
    return { success: true };
  },

  async setDNF() {
    const pid = await db.val('SELECT penya_id FROM estat_cursa WHERE id=1');
    if (pid) await db.query('INSERT INTO curses (penya_id, dnf) VALUES (?,1)', [pid]);
    await db.query(RESET_PISTA_SQL);
    return { success: true };
  },

  async anularBaixada({ data }) {
    await db.query(
      'UPDATE curses SET invalida=1 WHERE penya_id=? AND invalida=0 ORDER BY id DESC LIMIT 1',
      [nul(data.penya_id)]);
    await db.query(RESET_PISTA_SQL);
    return { success: true };
  },

  async finishCarret() {
    const now = serverTimeMs();
    const cursa = await db.one('SELECT * FROM estat_cursa WHERE id=1');
    if (!cursa || cursa.sortida_ms == null) {
      return { success: false, error: 'No hi ha cap baixada en curs.' };
    }
    const temps = now - Number(cursa.sortida_ms) - int(cursa.pausa_acum_ms);
    const r = await db.query(
      'INSERT INTO curses (penya_id, sortida_ms, meta_ms, temps_total_ms) VALUES (?,?,?,?)',
      [cursa.penya_id, cursa.sortida_ms, now, temps]);
    await db.query('UPDATE estat_cursa SET estat=1 WHERE id=1');
    return { success: true, temps, cursa_id: r.insertId };
  },

  // ── HABILITAT (banderes + globus) ─────────────────────────────────────────
  async saveSkill({ data }) {
    await db.query('UPDATE curses SET banderes=?, globus_petat=? WHERE id=?',
      [nul(data.banderes), nul(data.globus_petat), nul(data.cursa_id)]);
    await db.query('UPDATE estat_cursa SET estat=2 WHERE id=1');
    return { success: true };
  },

  // ── TEMPS DE SERVIDOR ─────────────────────────────────────────────────────
  async getServerTime() {
    const t = Date.now();
    return { t1: t, t2: t, server_time: serverTimeMs() };
  },

  // ── PENYES ────────────────────────────────────────────────────────────────
  async getPenyes() {
    return db.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM sancions WHERE penya_id=p.id) as num_sancions,
              (SELECT MIN(temps_total_ms) FROM curses WHERE penya_id=p.id AND dnf=0 AND invalida=0) as millor_ms
       FROM penyes p
       ORDER BY nom ASC`);
  },

  async createPenya({ data }) {
    const id = await db.withConnection(async (conn) => {
      await conn.beginTransaction();
      try {
        const [r] = await conn.query(
          'INSERT INTO penyes (nom, nom_carreto, membres, info_speaker) VALUES (?,?,?,?)',
          [nul(data.nom), nul(data.nom_carreto), nul(data.membres), nul(data.info)]);
        await conn.query('INSERT INTO inspeccions (penya_id) VALUES (?)', [r.insertId]);
        await conn.commit();
        return r.insertId;
      } catch (e) {
        await conn.rollback();
        throw e;
      }
    });
    return { success: true, id };
  },

  async updatePenya({ data }) {
    await db.query(
      'UPDATE penyes SET nom=?, nom_carreto=?, membres=?, info_speaker=? WHERE id=?',
      [nul(data.nom), nul(data.nom_carreto), nul(data.membres), nul(data.info), nul(data.id)]);
    return { success: true };
  },

  // ── LIVE STATUS ───────────────────────────────────────────────────────────
  async getLiveStatus() {
    const res = (await db.one(LIVE_SQL)) || {};
    res.serverMs = serverTimeMs();
    if (res.estat == 1 || res.estat == 2) {
      const c = await db.one(
        `SELECT id, temps_total_ms, banderes, globus_petat
         FROM curses
         WHERE penya_id=? AND invalida=0
         ORDER BY id DESC LIMIT 1`, [res.penya_id]);
      if (c) {
        res.cursa_id = c.id;
        res.temps_fixat = c.temps_total_ms;
        res.banderes = c.banderes;
        res.globus_petat = c.globus_petat;
      }
    }
    return res;
  },

  // ── FCM TOKEN ─────────────────────────────────────────────────────────────
  async fcmRegisterToken({ data }) {
    await db.query(
      `INSERT INTO fcm_tokens (token, rol, device) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE rol=VALUES(rol), device=VALUES(device), ultima_act=NOW()`,
      [nul(data.token), data.rol ?? 'general', data.device ?? null]);
    return { success: true };
  },

  // ── RANKINGS COMPLETS (speaker / ranking visual) ──────────────────────────
  async getRankingsFull() {
    const vel_tots = await db.query(
      `SELECT p.nom, MIN(c.temps_total_ms) as temps
       FROM curses c JOIN penyes p ON c.penya_id=p.id
       WHERE c.dnf=0 AND c.invalida=0
       GROUP BY p.id, p.nom ORDER BY temps ASC`);

    const habilitat = await db.query(
      `SELECT p.nom,
              MAX(c.banderes)     as banderes,
              MIN(c.globus_petat) as globus_petat,
              MAX(IF(c.banderes=3,10,0) + IF(c.globus_petat=0,10,0)) as totals
       FROM curses c JOIN penyes p ON c.penya_id=p.id
       WHERE c.dnf=0 AND c.invalida=0
       GROUP BY p.id, p.nom ORDER BY totals DESC LIMIT 10`);

    const estetica = await db.query(
      `SELECT p.nom, ROUND(AVG(pe.nota), 2) as punts
       FROM puntuacions_estetica pe JOIN penyes p ON pe.penya_id=p.id
       GROUP BY p.id, p.nom ORDER BY punts DESC LIMIT 10`);

    return {
      vel_millor: vel_tots.slice(0, 10),
      vel_tots,
      habilitat,
      estetica,
    };
  },

  // ── CARREPUNTS (classificació final) ──────────────────────────────────────
  async getCarrepunts() {
    await db.ensureTables();

    // a) Millor temps per penya
    const millorTemps = (await db.query(
      `SELECT p.id, p.nom, p.nom_carreto, MIN(c.temps_total_ms) as temps_ms
       FROM curses c JOIN penyes p ON c.penya_id=p.id
       WHERE c.dnf=0 AND c.invalida=0
       GROUP BY p.id, p.nom, p.nom_carreto`)).map((r) => ({ ...r, temps_ms: Number(r.temps_ms) }));

    // b) Millors banderes i globus per penya
    const habRows = await db.query(
      `SELECT penya_id, MAX(banderes) as banderes, MIN(globus_petat) as globus_petat
       FROM curses WHERE dnf=0 AND invalida=0 GROUP BY penya_id`);
    const habMap = new Map(habRows.map((h) => [h.penya_id, h]));

    // c) Mitjana d'estètica per penya
    const estRows = await db.query(
      `SELECT penya_id, ROUND(AVG(nota), 2) as nota_avg FROM puntuacions_estetica GROUP BY penya_id`);
    const estMap = new Map(estRows.map((e) => [e.penya_id, parseFloat(e.nota_avg)]));

    // d) Punts de velocitat: top 50% de participants, de topN fins a 1, normalitzats a 0-10
    const total = millorTemps.length;
    const topN = Math.ceil(total / 2);
    millorTemps.sort((a, b) => a.temps_ms - b.temps_ms);

    const ptsVelocitat = new Map();
    millorTemps.forEach((p, i) => {
      const pos = i + 1;
      if (topN <= 10) {
        ptsVelocitat.set(p.id, pos <= topN ? topN - pos + 1 : 0);
      } else {
        ptsVelocitat.set(p.id, pos <= topN ? Math.round(((topN - pos + 1) / topN) * 10) : 0);
      }
    });

    // e) Construir resultats
    const resultats = millorTemps.map((p) => {
      const hab = habMap.get(p.id) || { banderes: 0, globus_petat: 1 };
      const ptsBand = int(hab.banderes) === 3 ? 10 : 0;
      const ptsGlob = int(hab.globus_petat) === 0 ? 10 : 0;
      const ptsEst = estMap.get(p.id) ?? 0;
      const ptsVel = ptsVelocitat.get(p.id) ?? 0;
      return {
        id: Number(p.id),
        nom: p.nom,
        nom_carreto: p.nom_carreto,
        temps_ms: p.temps_ms,
        pts_velocitat: ptsVel,
        pts_banderes: ptsBand,
        pts_globus: ptsGlob,
        pts_estetica: ptsEst,
        total: round2(ptsVel + ptsBand + ptsGlob + ptsEst),
      };
    });

    // f) Ordenar: total DESC → temps ASC → estètica DESC
    resultats.sort((a, b) =>
      (b.total - a.total) || (a.temps_ms - b.temps_ms) || (b.pts_estetica - a.pts_estetica));

    // g) Posició final i punts de Festa Major → desar a punts_penya (una sola consulta)
    resultats.forEach((r, i) => {
      const pos = i + 1;
      r.pos_final = pos;
      r.punts_festa = pos <= 3 ? 3 : (pos <= 10 ? 2 : 1);
    });
    if (resultats.length) {
      await db.query(
        `INSERT INTO punts_penya (penya_id, prova, posicio_baixada, carrepunts_total, punts_festa)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           posicio_baixada=VALUES(posicio_baixada),
           carrepunts_total=VALUES(carrepunts_total),
           punts_festa=VALUES(punts_festa)`,
        [resultats.map((r) => [r.id, 'baixada_carretons', r.pos_final, r.total, r.punts_festa])]);
    }
    return resultats;
  },

  // ── INSPECCIÓ ─────────────────────────────────────────────────────────────
  async setInspeccio({ data }) {
    const c = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((k) => (truthy(data[k]) ? 1 : 0));
    await db.query(
      'UPDATE inspeccions SET c1=?,c2=?,c3=?,c4=?,c5=?,c6=?,c7=? WHERE penya_id=?',
      [...c, nul(data.penya_id)]);
    const apte = c.every(Boolean);
    await db.query('UPDATE penyes SET estat_inspeccio=? WHERE id=?', [apte ? 'APTE' : 'PENDENT', nul(data.penya_id)]);
    return { success: true, apte };
  },

  // ── BLOQUEIG PISTA ────────────────────────────────────────────────────────
  async toggleBloqueig({ data }) {
    await db.query('UPDATE estat_cursa SET bloqueig_direccio=? WHERE id=1', [int(data.estat)]);
    return { success: true };
  },

  // ── HEARTBEAT ─────────────────────────────────────────────────────────────
  async heartbeat({ data }) {
    await db.ensureTables();
    await db.query(
      `INSERT INTO connexions (modul, ultima_act) VALUES (?, NOW())
       ON DUPLICATE KEY UPDATE ultima_act=NOW()`,
      [data.modul ?? 'desconegut']);
    return { success: true };
  },

  // ── STATS DIRECCIÓ ────────────────────────────────────────────────────────
  async getStatsDireccio() {
    const mitjana = await db.val('SELECT AVG(temps_total_ms) FROM curses WHERE dnf=0 AND invalida=0');
    const restants = await db.val(
      `SELECT COUNT(*) FROM penyes
       WHERE estat_inspeccio='APTE'
       AND id NOT IN (SELECT penya_id FROM curses WHERE dnf=0 AND invalida=0)`);
    return {
      mitjana_ms: mitjana ? parseFloat(mitjana) : 0,
      penyes_restants: Number(restants) || 0,
    };
  },

  // ── CONNEXIONS ────────────────────────────────────────────────────────────
  async getConnexions() {
    await db.ensureTables();
    return db.query(
      `SELECT modul, (TIMESTAMPDIFF(SECOND, ultima_act, NOW()) < 30) as online
       FROM connexions ORDER BY modul ASC`);
  },

  // ── PRÒXIMES PENYES ───────────────────────────────────────────────────────
  async getProximesPenyes() {
    return db.query(
      `SELECT p.nom FROM penyes p
       WHERE p.estat_inspeccio='APTE'
       AND p.id NOT IN (SELECT penya_id FROM curses WHERE dnf=0 AND invalida=0)
       ORDER BY p.ordre_sortida ASC LIMIT 5`);
  },

  // ── ORDRE SORTIDA ─────────────────────────────────────────────────────────
  async getOrdreSortida() {
    return db.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM curses c WHERE c.penya_id=p.id AND c.dnf=0 AND c.invalida=0) as ja_baixat
       FROM penyes p ORDER BY p.ordre_sortida ASC`);
  },

  async updateOrdreManual({ data }) {
    await db.query('UPDATE penyes SET ordre_sortida=? WHERE id=?', [nul(data.nou_ordre), nul(data.penya_id)]);
    return { success: true };
  },

  async sortejarOrdre() {
    const ids = (await db.query('SELECT id FROM penyes')).map((r) => r.id);
    for (let i = ids.length - 1; i > 0; i--) {         // Fisher–Yates
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    if (ids.length) {
      const cases = ids.map(() => 'WHEN ? THEN ?').join(' ');
      const params = [];
      ids.forEach((id, i) => params.push(id, i + 1));
      await db.query(
        `UPDATE penyes SET ordre_sortida = CASE id ${cases} END WHERE id IN (?)`, [...params, ids]);
    }
    return { success: true };
  },

  // ── SANCIONS ──────────────────────────────────────────────────────────────
  async getSancionsPenya({ query, data }) {
    const pid = query.id ?? data.id ?? null;
    return db.query('SELECT * FROM sancions WHERE penya_id=? ORDER BY id DESC', [pid]);
  },

  async addSancio({ data }) {
    await db.query('INSERT INTO sancions (penya_id, infraccio) VALUES (?,?)',
      [nul(data.penya_id), nul(data.infraccio)]);
    return { success: true };
  },

  // ── SPEAKER ───────────────────────────────────────────────────────────────
  async enviarMissatgeSpeaker({ data }) {
    await db.ensureTables();
    const msg = data.missatge ?? '';
    try {
      await db.query('UPDATE estat_cursa SET missatge_speaker=? WHERE id=1', [msg]);
    } catch (_) { /* la columna pot no existir: s'ignora, com a l'original */ }
    await db.query('INSERT INTO speaker_missatges (missatge) VALUES (?)', [msg]);
    return { success: true };
  },

  // ── DETALL PENYA (speaker) ────────────────────────────────────────────────
  async getPenyaDetall({ query, data }) {
    const pid = query.id ?? data.id ?? null;
    const [info, curses, sancions] = await Promise.all([
      db.one(
        `SELECT p.*, i.c1,i.c2,i.c3,i.c4,i.c5,i.c6,i.c7
         FROM penyes p LEFT JOIN inspeccions i ON i.penya_id=p.id
         WHERE p.id=?`, [pid]),
      db.query('SELECT * FROM curses WHERE penya_id=? AND invalida=0 ORDER BY id ASC', [pid]),
      db.query('SELECT * FROM sancions WHERE penya_id=? ORDER BY id DESC', [pid]),
    ]);
    return { info, curses, sancions };
  },

  // ── ESTÈTICA ──────────────────────────────────────────────────────────────
  async getPenyesEstetica({ query, data }) {
    const jutgeId = query.jutge_id ?? data.jutge_id ?? '';
    return db.query(
      `SELECT p.id, p.nom, p.nom_carreto,
              (SELECT COUNT(*) FROM puntuacions_estetica pe
               WHERE pe.penya_id=p.id AND pe.jutge_id=?) as ja_votada
       FROM penyes p
       WHERE p.estat_inspeccio='APTE'
       ORDER BY p.ordre_sortida ASC, p.nom ASC`, [jutgeId]);
  },

  async submitEstetica({ data }) {
    await db.query(
      `INSERT INTO puntuacions_estetica (jutge_id, penya_id, nota)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE nota=VALUES(nota)`,
      [nul(data.jutge_id), nul(data.penya_id), round2(parseFloat(data.nota) || 0)]);
    return { success: true };
  },

  // ── RANKINGS SIMPLES (llegat) ─────────────────────────────────────────────
  async getRankings() {
    const velocitat = await db.query(
      `SELECT p.nom, MIN(c.temps_total_ms) as temps
       FROM curses c JOIN penyes p ON c.penya_id=p.id
       WHERE c.dnf=0 AND c.invalida=0
       GROUP BY p.id, p.nom ORDER BY temps ASC LIMIT 10`);
    const estetica = await db.query(
      `SELECT p.nom, ROUND(AVG(pe.nota), 2) as punts
       FROM puntuacions_estetica pe JOIN penyes p ON pe.penya_id=p.id
       GROUP BY p.id, p.nom ORDER BY punts DESC LIMIT 10`);
    return { velocitat, estetica };
  },

  // ── REINICI DE LA COMPETICIÓ (abans reset.php) — només admin ─────────────
  async resetSistema({ req, session }) {
    if (req.method !== 'POST') return { __status: 405, error: 'Cal POST' };
    if (!session || session.role !== 'admin') return { __status: 403, error: 'Només per a administradors' };

    await db.withConnection(async (conn) => {
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      try {
        for (const t of ['curses', 'sancions', 'puntuacions_estetica', 'inspeccions']) {
          await conn.query(`TRUNCATE TABLE ${t}`);
        }
        await conn.query("UPDATE penyes SET estat_inspeccio = 'PENDENT', ordre_sortida = NULL");
        // Tornem a crear la fila d'inspecció de cada penya (si no, "setInspeccio" no tindria on escriure)
        await conn.query('INSERT INTO inspeccions (penya_id) SELECT id FROM penyes');
        await conn.query(
          `UPDATE estat_cursa SET penya_id = NULL, estat = NULL, sortida_ms = NULL,
           pausa_activa = 0, pausa_inici_ms = NULL, pausa_acum_ms = 0, bloqueig_direccio = 0 WHERE id = 1`);
      } finally {
        await conn.query('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
    return { success: true };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const action = String((req.query && req.query.action) || '');
  const data = (req.body && typeof req.body === 'object') ? req.body : {};
  const reply = (status, body) => res.status(status).send(JSON.stringify(body));

  try {
    // ── Sessió (login / logout / whoami) ────────────────────────────────────
    if (action === 'whoami') {
      const s = auth.getSession(req);
      return reply(200, s ? { auth: true, role: s.role } : { auth: false });
    }
    if (action === 'logout') {
      auth.clearSessionCookie(req, res);
      return reply(200, { success: true });
    }
    if (action === 'login') {
      if (req.method !== 'POST') return reply(405, { success: false, error: 'Cal POST' });
      const role = auth.roleForCode(String(data.code ?? ''));
      if (!role) {
        await new Promise((r) => setTimeout(r, 600)); // frena força bruta
        return reply(401, { success: false, error: 'Codi incorrecte' });
      }
      auth.setSessionCookie(req, res, role);
      return reply(200, { success: true, role, redirect: role === 'speaker' ? '/speaker' : '/' });
    }

    // ── Control d'accés ─────────────────────────────────────────────────────
    const session = auth.getSession(req);
    if (!session && !PUBLIC_ACTIONS.has(action)) {
      return reply(403, { error: 'No autoritzat' });
    }

    const handler = Object.prototype.hasOwnProperty.call(actions, action) ? actions[action] : null;
    if (!handler) return reply(400, { error: 'Acció desconeguda' });

    const out = await handler({ data, query: req.query || {}, session, req, res });
    if (out && out.__status) {
      const { __status, ...rest } = out;
      return reply(__status, rest);
    }
    return reply(200, out);
  } catch (e) {
    console.error(`[api:${action}]`, e);
    return reply(200, { error: 'Error del servidor' });
  }
};
