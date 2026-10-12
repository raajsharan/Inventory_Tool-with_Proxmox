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
// Caps how many of this broadcast-only socket a single account can hold open
// at once (multiple tabs/devices are normal; hundreds are not) — keyed by
// JWT subject rather than IP, since this hub sits behind the same reverse
// proxy as the REST API and isn't wired into Express's trust-proxy config.
const MAX_SOCKETS_PER_USER = 5;
const socketsByUser = new Map();

function init(server) {
  const wss = new WebSocketServer({ server, path: '/ws/alerts' });

  wss.on('connection', (ws, req) => {
    const { query } = parse(req.url, true);
    let userId;
    try {
      ({ id: userId } = jwt.verify(query.token, process.env.JWT_SECRET, { algorithms: ['HS256'] }));
    } catch {
      ws.close(4001, 'Unauthorized');
      return;
    }
    const existing = socketsByUser.get(userId) || new Set();
    if (existing.size >= MAX_SOCKETS_PER_USER) {
      ws.close(4008, 'Too many connections');
      return;
    }
    existing.add(ws);
    socketsByUser.set(userId, existing);

    clients.add(ws);
    const cleanup = () => {
      clients.delete(ws);
      const set = socketsByUser.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) socketsByUser.delete(userId);
      }
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
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
