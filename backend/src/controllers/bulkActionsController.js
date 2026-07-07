/**
 * bulkActionsController.js — factory for bulk update / delete across the four
 * inventory services. Runs per-row through the service layer so every
 * validation (department tags, duplicate checks, audit trail) still applies;
 * partial failures are reported per record instead of aborting the batch.
 */
const audit = require('../services/auditService');
const ApiError = require('../utils/ApiError');
const { verifyCurrentPassword } = require('../utils/verifyPassword');

// Fields settable through bulk update (camelCase, as mapBody expects).
const ALLOWED_FIELDS = [
  'serverStatus', 'location', 'eolStatus', 'patchingType', 'department',
  'assignedUser', 'manageEngineInstalled', 'tenableInstalled',
];

const MAX_BATCH = 500;

module.exports = function makeBulk(svc, entityType) {
  async function bulkUpdate(req, res, next) {
    try {
      const { ids, fields } = req.body || {};
      if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'ids is required');
      if (ids.length > MAX_BATCH) throw new ApiError(400, `Too many records — max ${MAX_BATCH} per bulk action`);

      const payload = {};
      for (const k of ALLOWED_FIELDS) {
        if (fields?.[k] !== undefined) payload[k] = fields[k];
      }
      if (!Object.keys(payload).length) throw new ApiError(400, 'No supported fields to update');

      let success = 0;
      const failures = [];
      for (const id of ids) {
        try {
          await svc.update(id, payload, req.user.id);
          success++;
        } catch (e) {
          failures.push({ id, error: e.details ? Object.values(e.details)[0] : e.message });
        }
      }
      await audit.log({
        user: req.user, action: 'BULK_UPDATE', entityType,
        details: { requested: ids.length, success, failed: failures.length, fields: Object.keys(payload) },
        ipAddress: req.ip,
      });
      res.json({ success, failed: failures.length, failures });
    } catch (e) { next(e); }
  }

  async function bulkRemove(req, res, next) {
    try {
      const { ids, password } = req.body || {};
      if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'ids is required');
      if (ids.length > MAX_BATCH) throw new ApiError(400, `Too many records — max ${MAX_BATCH} per bulk action`);
      await verifyCurrentPassword(req.user.id, password);

      let success = 0;
      const failures = [];
      for (const id of ids) {
        try {
          await svc.remove(id, req.user.id);
          success++;
        } catch (e) {
          failures.push({ id, error: e.message });
        }
      }
      await audit.log({
        user: req.user, action: 'BULK_DELETE', entityType,
        details: { requested: ids.length, success, failed: failures.length },
        ipAddress: req.ip,
      });
      res.json({ success, failed: failures.length, failures });
    } catch (e) { next(e); }
  }

  return { bulkUpdate, bulkRemove };
};
