'use strict';
const mysql = require('mysql2/promise');

let pool = null;
let tablesReady = null;

function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta la variable d\'entorn DATABASE_URL');
  const u = new URL(url);

  let ssl;
  if (process.env.DB_SSL !== 'false') {
    ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: process.env.DB_SSL_INSECURE !== 'true' };
  }

  pool = mysql.createPool({
    host: u.hostname,
    port: Number(u.port) || 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    charset: 'utf8mb4',
    dateStrings: true,          // TIMESTAMP com a text, com feia PHP/PDO
    waitForConnections: true,
    connectionLimit: 3,         // serverless: poques connexions per instància
    enableKeepAlive: true,
    ssl,
  });
  return pool;
}

/** Executa una consulta i retorna les files (SELECT) o l'objecte de resultat (INSERT/UPDATE). */
async function query(sql, params) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

/** Primera fila o null. */
async function one(sql, params) {
  const rows = await query(sql, params);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/** Primera columna de la primera fila o null. */
async function val(sql, params) {
  const row = await one(sql, params);
  return row ? Object.values(row)[0] : null;
}

/** Dóna una connexió dedicada (per a transaccions o SET de sessió). */
async function withConnection(fn) {
  const conn = await getPool().getConnection();
  try {
    return await fn(conn);
  } finally {
    conn.release();
  }
}

/** Taules que el codi original creava "al vol". Es creen un cop per instància. */
function ensureTables() {
  if (!tablesReady) {
    tablesReady = (async () => {
      await query(`CREATE TABLE IF NOT EXISTS punts_penya (
        id               INT NOT NULL AUTO_INCREMENT,
        penya_id         INT NOT NULL,
        prova            VARCHAR(100) NOT NULL DEFAULT 'baixada_carretons',
        posicio_baixada  INT DEFAULT NULL,
        carrepunts_total DECIMAL(6,2) DEFAULT 0.00,
        punts_festa      INT DEFAULT 0,
        calculat_el      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY penya_prova (penya_id, prova)
      ) DEFAULT CHARSET=utf8mb4`);
      await query(`CREATE TABLE IF NOT EXISTS connexions (
        modul      VARCHAR(50) PRIMARY KEY,
        ultima_act TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )`);
      await query(`CREATE TABLE IF NOT EXISTS speaker_missatges (
        id       INT AUTO_INCREMENT PRIMARY KEY,
        missatge VARCHAR(500),
        ts       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
    })().catch((e) => { tablesReady = null; throw e; });
  }
  return tablesReady;
}

module.exports = { getPool, query, one, val, withConnection, ensureTables };
