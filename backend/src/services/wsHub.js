/**
 * wsHub.js
 * --------
 * Minimal WebSocket broadcast hub for real-time alert notifications (the
 * dashboard bell). Clients authenticate with their existing JWT (same one
 * used for the REST API) via a query param on the connection URL, since
 * browsers can't set custom headers on a WebSocket handshake.
 *
 * Broadcasts are signal-only ("alerts:changed") — the client re-fetches
 * GET /api/alerts and diffs against what it already has, rather than this
 * hub pushing full alert payloads. That keeps classification/formatting
 * logic in exactly one place (alertsService) instead of duplicated here.
 */
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { parse } = require('url');

const clients = new Set();

function init(server) {
  const wss = new WebSocketServer({ server, path: '/ws/alerts' });

  wss.on('connection', (ws, req) => {
    const { query } = parse(req.url, true);
    try {
      jwt.verify(query.token, process.env.JWT_SECRET);
    } catch {
      ws.close(4001, 'Unauthorized');
      return;
    }
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  return wss;
}

function broadcastAlertsChanged() {
  const payload = JSON.stringify({ type: 'alerts:changed' });
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(payload); } catch { /* drop, client will reconnect */ }
    }
  }
}

module.exports = { init, broadcastAlertsChanged };
