// Business logic for accounts, transactions and transfers.
//
// Atomicity: every write that touches more than one row runs inside
// db.transaction(...). If anything inside throws, SQLite rolls back ALL
// changes made in that function, so a balance can never change without its
// transaction row (and a transfer can never be half-done).
const crypto = require('crypto');
const { ApiError, notFound } = require('./errors');

// Money is stored as integer cents in the DB and returned as a normal number.
const toAmount = (cents) => cents / 100;

const formatAccount = (row) => ({
  id: row.id,
  name: row.name,
  balance: toAmount(row.balance),
  created_at: row.created_at,
});

const formatTransaction = (row) => ({
  id: row.id,
  account_id: row.account_id,
  type: row.type,
  amount: toAmount(row.amount),
  description: row.description,
  reference_id: row.reference_id,
  created_at: row.created_at,
});

function createLedger(db) {
  const sql = {
    insertAccount: db.prepare(
      'INSERT INTO accounts (id, name, balance, created_at) VALUES (?, ?, 0, ?)'
    ),
    getAccount: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    findByReference: db.prepare(
      'SELECT id FROM transactions WHERE account_id = ? AND reference_id = ?'
    ),
    insertTransaction: db.prepare(`
      INSERT INTO transactions (id, account_id, type, amount, description, reference_id, created_at)
      VALUES (@id, @account_id, @type, @amount, @description, @reference_id, @created_at)
    `),
    getTransaction: db.prepare('SELECT * FROM transactions WHERE id = ?'),
    credit: db.prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?'),
    // "AND balance >= ?" guarantees we never go negative, even under concurrency.
    debit: db.prepare('UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?'),
    countTransactions: db.prepare('SELECT COUNT(*) AS total FROM transactions WHERE account_id = ?'),
    listTransactions: db.prepare(`
      SELECT * FROM transactions
      WHERE account_id = ?
      ORDER BY created_at DESC, seq DESC
      LIMIT ? OFFSET ?
    `),
  };

  function requireAccount(id) {
    const account = sql.getAccount.get(id);
    if (!account) throw notFound(`Account '${id}' not found`);
    return account;
  }

  // Inserts one transaction row and updates the balance.
  // Must be called from inside a db.transaction so both happen together.
  function applyTransaction({ accountId, type, amount, description, referenceId }) {
    if (sql.findByReference.get(accountId, referenceId)) {
      throw new ApiError(
        409,
        'DUPLICATE_TRANSACTION',
        `A transaction with reference_id '${referenceId}' already exists for account '${accountId}'`
      );
    }

    if (type === 'credit') {
      sql.credit.run(amount, accountId);
    } else {
      const result = sql.debit.run(amount, accountId, amount);
      if (result.changes === 0) {
        throw new ApiError(422, 'INSUFFICIENT_BALANCE', `Insufficient balance in account '${accountId}'`);
      }
    }

    const id = crypto.randomUUID();
    sql.insertTransaction.run({
      id,
      account_id: accountId,
      type,
      amount,
      description,
      reference_id: referenceId,
      created_at: new Date().toISOString(),
    });
    return sql.getTransaction.get(id);
  }

  return {
    createAccount({ name }) {
      const id = crypto.randomUUID();
      sql.insertAccount.run(id, name, new Date().toISOString());
      return formatAccount(sql.getAccount.get(id));
    },

    getAccount(id) {
      return formatAccount(requireAccount(id));
    },

    addTransaction: db.transaction((accountId, input) => {
      requireAccount(accountId);
      const tx = applyTransaction({ accountId, ...input });
      return {
        transaction: formatTransaction(tx),
        balance: toAmount(sql.getAccount.get(accountId).balance),
      };
    }),

    listTransactions(accountId, { page, limit }) {
      requireAccount(accountId);
      const { total } = sql.countTransactions.get(accountId);
      const rows = sql.listTransactions.all(accountId, limit, (page - 1) * limit);
      return {
        data: rows.map(formatTransaction),
        pagination: {
          page,
          limit,
          total_records: total,
          total_pages: Math.ceil(total / limit),
        },
      };
    },

    // Debit source + credit destination in ONE database transaction.
    // Both legs share the same reference_id (unique per account).
    transfer: db.transaction(({ fromAccountId, toAccountId, amount, description, referenceId }) => {
      requireAccount(fromAccountId);
      requireAccount(toAccountId);
      const debitTx = applyTransaction({
        accountId: fromAccountId, type: 'debit', amount,
        description: description ?? `Transfer to ${toAccountId}`, referenceId,
      });
      const creditTx = applyTransaction({
        accountId: toAccountId, type: 'credit', amount,
        description: description ?? `Transfer from ${fromAccountId}`, referenceId,
      });
      return {
        amount: toAmount(amount),
        reference_id: referenceId,
        from_account: formatAccount(sql.getAccount.get(fromAccountId)),
        to_account: formatAccount(sql.getAccount.get(toAccountId)),
        debit_transaction: formatTransaction(debitTx),
        credit_transaction: formatTransaction(creditTx),
      };
    }),
  };
}

module.exports = { createLedger };
