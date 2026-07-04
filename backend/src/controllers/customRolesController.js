const svc = require('../services/customRolesService');

const SYSTEM_ROLES = [
  { id: 'superadmin',    name: 'superadmin',    label: 'Superadmin',    description: 'Full system access — cannot be restricted',   isSystem: true },
  { id: 'admin',         name: 'admin',         label: 'Admin',         description: 'Manage users, settings, and all inventories', isSystem: true },
  { id: 'asset_manager', name: 'asset_manager', label: 'Asset Manager', description: 'Can add, edit, and import assets',            isSystem: true },
  { id: 'viewer',        name: 'viewer',        label: 'Viewer',        description: 'Read-only access to allowed pages',            isSystem: true },
];

function applyOverrides(roles, overrides) {
  return roles.map(r => ({
    ...r,
    label:       overrides[r.name]?.label       ?? r.label,
    description: overrides[r.name]?.description ?? r.description,
  }));
}

async function list(req, res, next) {
  try {
    const [custom, overrides] = await Promise.all([svc.listCustom(), svc.getSystemOverrides()]);
    const isSuperReq = req.user?.role === 'superadmin';
    const systemBase = isSuperReq ? SYSTEM_ROLES : SYSTEM_ROLES.filter(r => r.name !== 'superadmin');
    res.json({ system: applyOverrides(systemBase, overrides), custom });
  } catch (e) { next(e); }
}

async function listOptions(req, res, next) {
  try {
    const [custom, overrides] = await Promise.all([svc.listCustom(), svc.getSystemOverrides()]);
    const isSuperReq = req.user?.role === 'superadmin';
    const systemBase = isSuperReq ? SYSTEM_ROLES : SYSTEM_ROLES.filter(r => r.name !== 'superadmin');
    const options = [
      ...applyOverrides(systemBase, overrides).map(r => ({ label: r.label, value: r.name })),
      ...custom.map(r => ({ label: r.label, value: r.name })),
    ];
    res.json({ options });
  } catch (e) { next(e); }
}

async function updateSystem(req, res, next) {
  try {
    res.json(await svc.upsertSystemOverride(req.params.name, req.body, req.user.id));
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const role = await svc.create(req.body, req.user.id);
    res.status(201).json(role);
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    res.json(await svc.update(req.params.id, req.body));
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    await svc.remove(req.params.id);
    res.status(204).end();
  } catch (e) { next(e); }
}

module.exports = { list, listOptions, updateSystem, create, update, remove };
