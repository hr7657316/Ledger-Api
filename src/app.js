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

  app.use(require('./logger'));
  // strict: false lets JSON like "abc" or null through, so the validators can
  // reject it with a clear VALIDATION_ERROR ("body must be a JSON object").
  app.use(express.json({ strict: false }));

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
    } else if (!(err instanceof ApiError) && err.status >= 400 && err.status < 500) {
      // Client mistakes caught by Express itself (body too large, bad charset,
      // malformed URL like /accounts/%ZZ) keep their 4xx status instead of becoming a 500.
      const codes = { 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE' };
      const code = codes[err.status] || (err instanceof URIError ? 'INVALID_URL' : 'BAD_REQUEST');
      err = new ApiError(err.status, code, err.expose ? err.message : 'Bad request');
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
