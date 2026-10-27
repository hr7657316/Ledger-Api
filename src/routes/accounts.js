const express = require('express');
const { ApiError } = require('../errors');
const {
  validateCreateAccount,
  validateCreateTransaction,
  validatePagination,
} = require('../validators');

function accountRoutes(ledger) {
  const router = express.Router();

  // POST /accounts  -> create an account (balance always starts at 0)
  router.post('/', (req, res) => {
    const input = validateCreateAccount(req.body);
    res.status(201).json(ledger.createAccount(input));
  });

  // GET /accounts/:id  -> account details including balance
  router.get('/:id', (req, res) => {
    res.json(ledger.getAccount(req.params.id));
  });

  // GET /accounts/:id/balance  -> just the balance
  router.get('/:id/balance', (req, res) => {
    const account = ledger.getAccount(req.params.id);
    res.json({ account_id: account.id, balance: account.balance });
  });

  // POST /accounts/:id/transactions  -> add a credit or debit
  router.post('/:id/transactions', (req, res) => {
    const input = validateCreateTransaction(req.body);
    res.status(201).json(ledger.addTransaction(req.params.id, input));
  });

  // GET /accounts/:id/transactions?page=1&limit=10  -> history, latest first
  router.get('/:id/transactions', (req, res) => {
    const pagination = validatePagination(req.query);
    res.json(ledger.listTransactions(req.params.id, pagination));
  });

  // Transactions are immutable: editing or deleting is never allowed.
  router.all(['/:id/transactions', '/:id/transactions/:txId'], (req, res) => {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Transactions are immutable and cannot be modified or deleted');
  });

  return router;
}

module.exports = accountRoutes;
