// Input validation. Each function either returns clean data or throws a
// 400 VALIDATION_ERROR listing every problem found.
const { validationError } = require('./errors');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireObjectBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError([{ field: 'body', message: 'Request body must be a JSON object' }]);
  }
}

const MAX_AMOUNT = 1_000_000_000; // largest amount allowed in one transaction

// Amount must be a positive number with at most 2 decimal places.
// Returns the amount in cents (integer) to avoid floating point errors.
function parseAmount(value, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ field: 'amount', message: 'amount must be a number' });
    return null;
  }
  if (value <= 0) {
    errors.push({ field: 'amount', message: 'amount must be greater than 0' });
    return null;
  }
  if (value > MAX_AMOUNT) {
    errors.push({ field: 'amount', message: `amount must be at most ${MAX_AMOUNT}` });
    return null;
  }
  // Exact check: converting to cents and back must give the same number.
  // 10.5 -> 1050 -> 10.5 (ok), 1.234 -> 123 -> 1.23 (rejected), 0.001 -> 0 -> 0 (rejected).
  const cents = Math.round(value * 100);
  if (cents / 100 !== value) {
    errors.push({ field: 'amount', message: 'amount can have at most 2 decimal places' });
    return null;
  }
  return cents;
}

function validateDescription(value, errors) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    errors.push({ field: 'description', message: 'description must be a string' });
    return null;
  }
  if (value.length > 255) {
    errors.push({ field: 'description', message: 'description must be at most 255 characters' });
  }
  return value;
}

function validateReferenceId(value, errors) {
  if (!isNonEmptyString(value)) {
    errors.push({ field: 'reference_id', message: 'reference_id is required' });
    return null;
  }
  if (value.length > 100) {
    errors.push({ field: 'reference_id', message: 'reference_id must be at most 100 characters' });
  }
  return value.trim();
}

function validateCreateAccount(body) {
  requireObjectBody(body);
  const errors = [];
  if (!isNonEmptyString(body.name)) {
    errors.push({ field: 'name', message: 'name is required' });
  } else if (body.name.trim().length > 100) {
    errors.push({ field: 'name', message: 'name must be at most 100 characters' });
  }
  if (body.balance !== undefined) {
    errors.push({ field: 'balance', message: 'balance cannot be set; new accounts always start at 0' });
  }
  if (errors.length) throw validationError(errors);
  return { name: body.name.trim() };
}

function validateCreateTransaction(body) {
  requireObjectBody(body);
  const errors = [];
  if (body.type !== 'credit' && body.type !== 'debit') {
    errors.push({ field: 'type', message: "type must be either 'credit' or 'debit'" });
  }
  const amount = parseAmount(body.amount, errors);
  const description = validateDescription(body.description, errors);
  const referenceId = validateReferenceId(body.reference_id, errors);
  if (errors.length) throw validationError(errors);
  return { type: body.type, amount, description, referenceId };
}

function validateTransfer(body) {
  requireObjectBody(body);
  const errors = [];
  if (!isNonEmptyString(body.from_account_id)) {
    errors.push({ field: 'from_account_id', message: 'from_account_id is required' });
  }
  if (!isNonEmptyString(body.to_account_id)) {
    errors.push({ field: 'to_account_id', message: 'to_account_id is required' });
  }
  if (isNonEmptyString(body.from_account_id) && body.from_account_id === body.to_account_id) {
    errors.push({ field: 'to_account_id', message: 'cannot transfer to the same account' });
  }
  const amount = parseAmount(body.amount, errors);
  const description = validateDescription(body.description, errors);
  const referenceId = validateReferenceId(body.reference_id, errors);
  if (errors.length) throw validationError(errors);
  return {
    fromAccountId: body.from_account_id,
    toAccountId: body.to_account_id,
    amount,
    description,
    referenceId,
  };
}

// Query params for transaction history:
// page and limit are optional (defaults: page=1, limit=10; max page=1,000,000, max limit=100).
// type is optional: 'credit' or 'debit'. Not given -> both.
function validateHistoryQuery(query) {
  const errors = [];
  const parse = (name, raw, def, max) => {
    if (raw === undefined) return def;
    if (!/^\d+$/.test(String(raw)) || Number(raw) < 1) {
      errors.push({ field: name, message: `${name} must be a positive integer` });
      return null;
    }
    if (max && Number(raw) > max) {
      errors.push({ field: name, message: `${name} must be at most ${max}` });
      return null;
    }
    return Number(raw);
  };
  const page = parse('page', query.page, 1, 1_000_000);
  const limit = parse('limit', query.limit, 10, 100);
  if (errors.length) {
    const err = validationError(errors);
    err.code = 'INVALID_PAGINATION';
    err.message = 'Invalid pagination parameters';
    throw err;
  }
  const { type } = query;
  if (type !== undefined && type !== 'credit' && type !== 'debit') {
    throw validationError([{ field: 'type', message: "type must be either 'credit' or 'debit'" }]);
  }
  return { page, limit, type };
}

module.exports = {
  validateCreateAccount,
  validateCreateTransaction,
  validateTransfer,
  validateHistoryQuery,
};
