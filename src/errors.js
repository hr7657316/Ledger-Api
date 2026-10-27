// One error class used everywhere, so every error response has the same shape:
// { "error": { "code": "...", "message": "...", "details": [...] } }
class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const notFound = (message) => new ApiError(404, 'NOT_FOUND', message);
const validationError = (details) =>
  new ApiError(400, 'VALIDATION_ERROR', 'Request data is invalid', details);

module.exports = { ApiError, notFound, validationError };
