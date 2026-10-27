const express = require('express');
const { validateTransfer } = require('../validators');

function transferRoutes(ledger) {
  const router = express.Router();

  // POST /transfers  -> move money between two accounts atomically
  router.post('/', (req, res) => {
    const input = validateTransfer(req.body);
    res.status(201).json(ledger.transfer(input));
  });

  return router;
}

module.exports = transferRoutes;
