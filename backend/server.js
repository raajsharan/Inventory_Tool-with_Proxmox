require('dotenv').config();

// Without these, an unhandled rejection/exception can crash the process
// silently (journalctl shows only the systemd restart, not why) — log the
// cause before exiting so a real crash is diagnosable, then let systemd's
// Restart=on-failure bring it back up.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[fatal] Unhandled Rejection:', reason);
});
process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[fatal] Uncaught Exception:', err);
  process.exit(1);
});

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const swaggerUi = require('swagger-ui-express');

const swaggerSpec = require('./src/config/swagger');
const errorHandler = require('./src/middleware/errorHandler');
const routes = require('./src/routes');
const wsHub = require('./src/services/wsHub');

const app = express();

app.use(helmet());
// Large JSON payloads (asset lists, discovery/dashboard aggregations) and the
// static frontend bundle all benefit from gzip — cheap win, no correctness risk.
app.use(compression());
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:4000').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    // Allow any localhost port in development (Vite may start on a different port)
    if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', (_req, res) => {
  const { getVersion } = require('./src/utils/version');
  const v = getVersion();
  res.json({ status: 'ok', ts: new Date().toISOString(), commit: v.commit, started_at: v.started_at });
});

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api', routes);

const distPath = path.join(__dirname, '../frontend/dist');
app.use(express.static(distPath));
app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
(async () => {
  try {
    await require('./src/bootstrap/ensureSchema')();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ensure-schema] failed:', e);
  }
  try {
    await require('./src/bootstrap/ensureSuperadmin')();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[bootstrap] failed:', e);
  }
  try {
    await require('./src/services/backupScheduler').start();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[backup-scheduler] failed to start:', e);
  }
  try {
    await require('./src/services/vmwareSchedulerService').initFromDb();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[vmware-scheduler] failed to start:', e);
  }
  try {
    await require('./src/services/proxmoxSchedulerService').initFromDb();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[proxmox-scheduler] failed to start:', e);
  }
  try {
    await require('./src/services/hypervSchedulerService').initFromDb();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[hyperv-scheduler] failed to start:', e);
  }
  try {
    await require('./src/services/pingMonitorService').initFromDb();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[ping-monitor] failed to start:', e);
  }
  const server = http.createServer(app);
  wsHub.init(server);
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[inventory-api] listening on :${PORT} (${process.env.NODE_ENV || 'development'})`);
  });
})();

module.exports = app;
