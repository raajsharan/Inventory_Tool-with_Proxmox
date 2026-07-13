const svc = require('../services/endpointCentralService');

async function getConfig(req, res, next) {
  try {
    const cfg     = await svc.getConfig();
    const isAdmin = ['admin', 'superadmin'].includes(req.user?.role);
    res.json({
      server_url:  cfg.server_url  || '',
      customer_id: cfg.customer_id || '1',
      api_key:     isAdmin ? (cfg.api_key || '') : (cfg.api_key ? '••••••••' : ''),
      api_path:    cfg.api_path    || '',
      verify_ssl:  cfg.verify_ssl  || false,
      configured:  !!(cfg.server_url && cfg.api_key),
      updated_by:  cfg.updated_by  || null,
      updated_at:  cfg.updated_at  || null,
    });
  } catch (e) { next(e); }
}

async function saveConfig(req, res, next) {
  try {
    const { server_url, customer_id, api_key, api_path, verify_ssl } = req.body;
    await svc.saveConfig({ server_url, customer_id, api_key, api_path, verify_ssl }, req.user?.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

async function testConnection(req, res, next) {
  try {
    const result = await svc.testConnection();
    res.json(result);
  } catch (e) { next(e); }
}

async function listAgents(req, res, next) {
  try {
    const agents = await svc.fetchAgents();
    res.json({ agents, total: agents.length });
  } catch (e) { next(e); }
}

async function listSoftware(req, res, next) {
  try {
    // Forward documented ME EC filter params if provided by the client
    const { domainFilter, licensetypefilter, accesstypefilter, compliancestatusfilter } = req.query;
    const filters = {};
    if (domainFilter)            filters.domainFilter            = domainFilter;
    if (licensetypefilter        != null && licensetypefilter        !== '') filters.licensetypefilter        = licensetypefilter;
    if (accesstypefilter         != null && accesstypefilter         !== '') filters.accesstypefilter         = accesstypefilter;
    if (compliancestatusfilter   != null && compliancestatusfilter   !== '') filters.compliancestatusfilter   = compliancestatusfilter;
    const software = await svc.fetchSoftware(filters);
    res.json({ software, total: software.length });
  } catch (e) { next(e); }
}

module.exports = { getConfig, saveConfig, testConnection, listAgents, listSoftware };
