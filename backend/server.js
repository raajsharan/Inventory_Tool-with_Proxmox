require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');

const swaggerSpec = require('./src/config/swagger');
const errorHandler = require('./src/middleware/errorHandler');
const routes = require('./src/routes');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api', routes);

app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
(async () => {
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
  app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[inventory-api] listening on :${PORT} (${process.env.NODE_ENV || 'development'})`);
  });
})();

module.exports = app;
