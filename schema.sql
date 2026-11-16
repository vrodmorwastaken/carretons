-- ════════════════════════════════════════════════════════════════════════
--  Esquema de Carretons (reconstruït a partir de les consultes de api.php)
--  Compatible amb MySQL 5.7+/8, MariaDB i TiDB.
--
--  ⚠ Si pots, exporta l'esquema REAL des de phpMyAdmin (InfinityFree) i usa
--    aquell: és la font de veritat. Aquest fitxer és el "pla B".
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS penyes (
  id              INT NOT NULL AUTO_INCREMENT,
  nom             VARCHAR(150) NOT NULL,
  nom_carreto     VARCHAR(150) DEFAULT NULL,
  membres         TEXT,
  info_speaker    TEXT,
  estat_inspeccio VARCHAR(20) NOT NULL DEFAULT 'PENDENT',
  ordre_sortida   INT DEFAULT NULL,
  PRIMARY KEY (id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS estat_cursa (
  id                INT NOT NULL,
  penya_id          INT DEFAULT NULL,
  estat             TINYINT DEFAULT NULL,      -- NULL=lliure, 0=compte enrere, 1=meta, 2=habilitat desada
  sortida_ms        BIGINT DEFAULT NULL,
  pausa_activa      TINYINT NOT NULL DEFAULT 0,
  pausa_inici_ms    BIGINT DEFAULT NULL,
  pausa_acum_ms     BIGINT NOT NULL DEFAULT 0,
  bloqueig_direccio TINYINT NOT NULL DEFAULT 0,
  missatge_speaker  VARCHAR(500) DEFAULT NULL,
  PRIMARY KEY (id)
) DEFAULT CHARSET=utf8mb4;
INSERT IGNORE INTO estat_cursa (id) VALUES (1);

CREATE TABLE IF NOT EXISTS curses (
  id             INT NOT NULL AUTO_INCREMENT,
  penya_id       INT NOT NULL,
  sortida_ms     BIGINT DEFAULT NULL,
  meta_ms        BIGINT DEFAULT NULL,
  temps_total_ms BIGINT DEFAULT NULL,
  dnf            TINYINT NOT NULL DEFAULT 0,
  invalida       TINYINT NOT NULL DEFAULT 0,
  banderes       TINYINT NOT NULL DEFAULT 0,
  globus_petat   TINYINT NOT NULL DEFAULT 1,
  creat_el       TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_curses_penya (penya_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sancions (
  id        INT NOT NULL AUTO_INCREMENT,
  penya_id  INT NOT NULL,
  infraccio VARCHAR(255) DEFAULT NULL,
  creat_el  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sancions_penya (penya_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inspeccions (
  id       INT NOT NULL AUTO_INCREMENT,
  penya_id INT NOT NULL,
  c1 TINYINT NOT NULL DEFAULT 0,
  c2 TINYINT NOT NULL DEFAULT 0,
  c3 TINYINT NOT NULL DEFAULT 0,
  c4 TINYINT NOT NULL DEFAULT 0,
  c5 TINYINT NOT NULL DEFAULT 0,
  c6 TINYINT NOT NULL DEFAULT 0,
  c7 TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inspeccio_penya (penya_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS puntuacions_estetica (
  id       INT NOT NULL AUTO_INCREMENT,
  jutge_id VARCHAR(50) NOT NULL,
  penya_id INT NOT NULL,
  nota     DECIMAL(4,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jutge_penya (jutge_id, penya_id)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fcm_tokens (
  id         INT NOT NULL AUTO_INCREMENT,
  token      VARCHAR(300) NOT NULL,
  rol        VARCHAR(30) NOT NULL DEFAULT 'general',
  device     VARCHAR(150) DEFAULT NULL,
  ultima_act TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_token (token)
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS comissaris_pista (
  id              INT NOT NULL AUTO_INCREMENT,
  nom             VARCHAR(100) DEFAULT NULL,
  token           VARCHAR(100) NOT NULL,
  posicio         VARCHAR(100) NOT NULL DEFAULT '',
  status          VARCHAR(30) NOT NULL DEFAULT 'espera',
  pausa_ms        BIGINT DEFAULT NULL,
  pausa_acceptada TINYINT DEFAULT NULL,
  missatge        VARCHAR(500) DEFAULT NULL,
  ultima_act      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_comissari_token (token)
) DEFAULT CHARSET=utf8mb4;

-- Aquestes tres l'API les crea soles si no hi són; les deixem aquí per claredat.
CREATE TABLE IF NOT EXISTS connexions (
  modul      VARCHAR(50) PRIMARY KEY,
  ultima_act TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS speaker_missatges (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  missatge VARCHAR(500),
  ts       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS punts_penya (
  id               INT NOT NULL AUTO_INCREMENT,
  penya_id         INT NOT NULL,
  prova            VARCHAR(100) NOT NULL DEFAULT 'baixada_carretons',
  posicio_baixada  INT DEFAULT NULL,
  carrepunts_total DECIMAL(6,2) DEFAULT 0.00,
  punts_festa      INT DEFAULT 0,
  calculat_el      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY penya_prova (penya_id, prova)
) DEFAULT CHARSET=utf8mb4;
