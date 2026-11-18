const DEFAULT_PERMISSIONS = Object.freeze({
  assistant: true,
  crm: true,
  google: true,
  whatsapp: true,
  messenger: true,
  telegram: true,
  n8n: true,
  flows: true,
  instagram: true,
  youtube: true,
  voice: true,
  write: true,
});

function permissionsFor(user) {
  if (!user) return Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map(k => [k, false]));
  if (user.role === 'admin') return { ...DEFAULT_PERMISSIONS };
  let stored = user.permissions;
  if (typeof stored === 'string') { try { stored = JSON.parse(stored); } catch { stored = {}; } }
  return Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map(k => [k, stored?.[k] !== false]));
}

function normalizePermissions(value) {
  const p = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map(k => [k, p[k] !== false]));
}

function can(user, permission) { return permissionsFor(user)[permission] === true; }

function toolAllowed(tool, user) {
  if (tool.permission && !can(user, tool.permission)) return false;
  if (tool.drafts && !can(user, 'write')) return false;
  return true;
}

function requirePermission(permission) {
  return (req, res, next) => can(req.user, permission)
    ? next()
    : res.status(403).json({ error: `Your account does not have access to ${permission}. Ask an admin to change your access.` });
}

module.exports = { DEFAULT_PERMISSIONS, permissionsFor, normalizePermissions, can, toolAllowed, requirePermission };
