-- ============================================================
-- StockVault D1 Database Schema
-- Cloudflare D1 (SQLite) — created 2026-05-21
-- ============================================================

-- -----------------------------------------------------------
-- positions: core table for every open / closed stock position
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS positions (
  id               TEXT PRIMARY KEY,
  symbol           TEXT NOT NULL,
  name             TEXT NOT NULL,
  market           TEXT NOT NULL CHECK (market IN ('A_SHARE', 'HK', 'US', 'SWISS')),
  currency         TEXT NOT NULL DEFAULT 'CNY',
  open_date        TEXT NOT NULL,                     -- ISO-8601 date
  open_price       REAL NOT NULL,
  open_rate_to_cny REAL NOT NULL DEFAULT 1.0,
  quantity         REAL NOT NULL CHECK (quantity > 0),
  commission       REAL NOT NULL DEFAULT 0,
  close_date       TEXT,
  close_price      REAL,
  close_rate_to_cny REAL,
  close_commission REAL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  sector           TEXT,                              -- industry / sector label
  beta             REAL,                              -- beta coefficient
  notes            TEXT,
  tags             TEXT,                              -- comma-separated tags
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions (symbol);
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions (market);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions (status);
CREATE INDEX IF NOT EXISTS idx_positions_market_status ON positions (market, status);
CREATE INDEX IF NOT EXISTS idx_positions_open_date ON positions (open_date);

-- -----------------------------------------------------------
-- trades: individual buy / sell trade records
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS trades (
  id            TEXT PRIMARY KEY,
  position_id   TEXT,
  symbol        TEXT NOT NULL,
  name          TEXT NOT NULL,
  market        TEXT NOT NULL CHECK (market IN ('A_SHARE', 'HK', 'US', 'SWISS')),
  trade_type    TEXT NOT NULL CHECK (trade_type IN ('BUY', 'SELL')),
  price         REAL NOT NULL,
  quantity      REAL NOT NULL CHECK (quantity > 0),
  commission    REAL NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'CNY',
  rate_to_cny   REAL NOT NULL DEFAULT 1.0,
  trade_date    TEXT NOT NULL,                        -- ISO-8601 date
  notes         TEXT,
  realized_pnl  REAL,                                 -- realized PnL in native currency (for SELL)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (position_id) REFERENCES positions (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_trades_position_id ON trades (position_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades (symbol);
CREATE INDEX IF NOT EXISTS idx_trades_market ON trades (market);
CREATE INDEX IF NOT EXISTS idx_trades_trade_date ON trades (trade_date);
CREATE INDEX IF NOT EXISTS idx_trades_trade_type ON trades (trade_type);

-- -----------------------------------------------------------
-- quote_cache: last-fetched live quotes (TTL managed in code)
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS quote_cache (
  symbol         TEXT PRIMARY KEY,
  price          REAL,
  change_amount  REAL,
  change_percent REAL,
  high           REAL,
  low            REAL,
  volume         INTEGER,
  prev_close     REAL,
  currency       TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------
-- exchange_rates: cached FX rates to CNY
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_rates (
  base_currency   TEXT NOT NULL,
  target_currency TEXT NOT NULL,
  rate            REAL NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (base_currency, target_currency)
);

-- -----------------------------------------------------------
-- portfolio_snapshots: daily per-market portfolio snapshots
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  snapshot_date    TEXT NOT NULL,                     -- ISO-8601 date
  market           TEXT NOT NULL CHECK (market IN ('A_SHARE', 'HK', 'US', 'SWISS', 'ALL')),
  total_value_cny  REAL NOT NULL DEFAULT 0,
  total_cost_cny   REAL NOT NULL DEFAULT 0,
  total_pnl_cny    REAL NOT NULL DEFAULT 0,
  position_count   INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (snapshot_date, market)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_date ON portfolio_snapshots (snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_market ON portfolio_snapshots (market);

-- -----------------------------------------------------------
-- user_settings: generic key-value settings store
-- -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------
-- Triggers: auto-update updated_at on positions
-- -----------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_positions_updated_at
AFTER UPDATE ON positions
FOR EACH ROW
BEGIN
  UPDATE positions SET updated_at = datetime('now') WHERE id = OLD.id;
END;

-- -----------------------------------------------------------
-- Seed default user settings
-- -----------------------------------------------------------
INSERT OR IGNORE INTO user_settings (key, value) VALUES ('default_market', 'A_SHARE');
INSERT OR IGNORE INTO user_settings (key, value) VALUES ('quote_cache_ttl_seconds', '300');
INSERT OR IGNORE INTO user_settings (key, value) VALUES ('base_currency', 'CNY');
