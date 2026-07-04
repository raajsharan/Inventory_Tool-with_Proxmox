const isDev = process.env.NODE_ENV !== 'production';

// eslint-disable-next-line no-unused-vars
module.exports = (err, req, res, _next) => {
  const status = err.status || 500;
  // eslint-disable-next-line no-console
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: status < 500 || isDev ? (err.message || 'Internal Server Error') : 'Internal Server Error',
    ...(isDev && err.details ? { details: err.details } : {}),
  });
};
