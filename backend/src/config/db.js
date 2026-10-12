const { Pool } = require('pg');

// Off by default — plenty of valid deployments run Postgres on the same host
// or a private network with no TLS cert configured on the server side, and
// forcing `ssl` on would just break the connection outright for those. Set
// DB_SSL=true when Postgres is reachable over a network that isn't already
// trusted/encrypted (e.g. a managed/cloud Postgres instance). When enabled,
// DB_SSL_REJECT_UNAUTHORIZED defaults to strict verification; set it to
// 'false' only for a self-signed cert you can't add to the trust store.
const sslEnabled = process.env.DB_SSL === 'true';
const ssl = sslEnabled
  ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
  : false;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  ssl,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[pg] idle client error', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};
