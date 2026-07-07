require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const swaggerUi = require('swagger-ui-express');

const swaggerSpec = require('./src/config/swagger');
const errorHandler = require('./src/middleware/errorHandler');
const routes = require('./src/routes');

const app = express();

app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:4000').split(',').map(s => s.trim());
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
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
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[inventory-api] listening on :${PORT} (${process.env.NODE_ENV || 'development'})`);
  });
})();

module.exports = app;
