// Builds the Express app. Kept separate from server.js so tests can create
// an app with an in-memory database.
const express = require('express');
const { createDatabase } = require('./db');
const { createLedger } = require('./ledger');
const { ApiError } = require('./errors');
const accountRoutes = require('./routes/accounts');
const transferRoutes = require('./routes/transfers');

function createApp({ dbFile } = {}) {
  const db = createDatabase(dbFile);
  const ledger = createLedger(db);
  const app = express();

  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/accounts', accountRoutes(ledger));
  app.use('/transfers', transferRoutes(ledger));

  // Unknown routes
  app.use((req, res) => {
    throw new ApiError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`);
  });

  // Central error handler: turns every error into the same JSON shape.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      err = new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON');
    } else if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      err = new ApiError(409, 'DUPLICATE_TRANSACTION', 'Duplicate reference_id for this account');
    } else if (!(err instanceof ApiError)) {
      console.error(err);
      err = new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong');
    }
    const body = { error: { code: err.code, message: err.message } };
    if (err.details) body.error.details = err.details;
    res.status(err.status).json(body);
  });

  app.locals.db = db;
  return app;
}

module.exports = { createApp };
