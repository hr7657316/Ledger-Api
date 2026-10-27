// Database setup: opens the SQLite file and creates the tables.
// The database constraints are the last line of defence for data integrity,
// even if application code has a bug.
const Database = require('better-sqlite3');

function createDatabase(file = process.env.DB_FILE || 'ledger.db') {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON'); // SQLite needs this to enforce FOREIGN KEY

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
      balance     INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0), -- stored in cents
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      seq          INTEGER PRIMARY KEY AUTOINCREMENT,  -- insertion order, used as tie-breaker when sorting
      id           TEXT NOT NULL UNIQUE,
      account_id   TEXT NOT NULL REFERENCES accounts(id),
      type         TEXT NOT NULL CHECK (type IN ('credit', 'debit')),
      amount       INTEGER NOT NULL CHECK (amount > 0),  -- stored in cents
      description  TEXT,
      reference_id TEXT NOT NULL CHECK (length(trim(reference_id)) > 0),
      created_at   TEXT NOT NULL,
      UNIQUE (account_id, reference_id)                  -- no duplicate reference per account
    );

    CREATE INDEX IF NOT EXISTS idx_tx_account_created
      ON transactions (account_id, created_at DESC, seq DESC);

    -- Transactions are immutable: block UPDATE and DELETE at the database level.
    CREATE TRIGGER IF NOT EXISTS transactions_no_update
      BEFORE UPDATE ON transactions
      BEGIN SELECT RAISE(ABORT, 'transactions are immutable'); END;

    CREATE TRIGGER IF NOT EXISTS transactions_no_delete
      BEFORE DELETE ON transactions
      BEGIN SELECT RAISE(ABORT, 'transactions are immutable'); END;
  `);

  return db;
}

module.exports = { createDatabase };
