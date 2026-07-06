const isDev = process.env.NODE_ENV !== 'production';

// Translate common PostgreSQL errors into actionable 4xx responses instead
// of an opaque "Internal Server Error".
function translatePgError(err) {
  switch (err.code) {
    case '23505': { // unique_violation
      const field = (err.constraint || '').replace(/^[a-z_]+?_(.+?)_key$/, '$1') || 'value';
      return {
        status: 409,
        message: `Duplicate ${field.replace(/_/g, ' ')} — another record already uses this value`,
        details: err.detail,
      };
    }
    case '23503': // foreign_key_violation
      return { status: 400, message: 'Referenced record does not exist', details: err.detail };
    case '23502': // not_null_violation
      return { status: 400, message: `${err.column || 'A required field'} cannot be empty`, details: err.detail };
    case '22001': // string_data_right_truncation
      return { status: 400, message: 'A value is too long for its field', details: err.detail };
    case '42P01': // undefined_table
      return { status: 500, message: `Database table missing (${err.message}) — restart the backend to apply schema updates`, details: err.detail };
    default:
      return null;
  }
}

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, _next) => {
  const pg = err.code ? translatePgError(err) : null;
  const status = pg?.status || err.status || 500;
  // eslint-disable-next-line no-console
  if (status >= 500) console.error('[error]', err);

  const message = pg?.message
    || (status < 500 || isDev ? (err.message || 'Internal Server Error') : 'Internal Server Error');
  const details = pg?.details ?? err.details;

  res.status(status).json({
    error: message,
    ...((status < 500 || isDev) && details ? { details } : {}),
  });
};
