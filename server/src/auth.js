// Accounts. No default user and no baked-in password: the FIRST visitor creates
// the admin account (/api/auth/setup), which only works while the users table is
// empty. After that, admins issue single-use invitations from Settings → Account.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const { permissionsFor, normalizePermissions } = require('./permissions');
const { randomToken, encrypt, decrypt } = require('./crypto');
const baseUrl = require('./baseUrl');
const { SESSION_SECRET, COOKIE_NAME, DEMO_LOGIN_EMAIL, DEMO_LOGIN_PASSWORD } = require('./config');

const router = express.Router();
const TTL_S = 7 * 24 * 3600;

const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, permissions: permissionsFor(u) });

function issue(res, req, user) {
  const token = jwt.sign({ id: user.id }, SESSION_SECRET, { expiresIn: TTL_S });
  // Secure on HTTPS (incl. behind a TLS proxy — trust proxy is on); plain-HTTP localhost installs still work.
  const secure = req.secure;
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', secure, maxAge: TTL_S * 1000, path: '/' });
}

function userFromToken(token) {
  if (!token) return null;
  try {
    const { id } = jwt.verify(token, SESSION_SECRET);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const u = userFromToken(req.cookies?.[COOKIE_NAME]);
  if (!u) return res.status(401).json({ error: 'Sign in first.' });
  req.user = u;
  next();
}
function workspaceContext(req, res, next) {
  const token = req.get('X-LordMinds-Context');
  if (!token) return next();
  try {
    const context = jwt.verify(token, SESSION_SECRET);
    if (context.kind !== 'admin-context' || context.actorId !== req.user.id || req.user.role !== 'admin') throw new Error('Invalid admin context');
    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(context.targetId);
    if (!target) return res.status(401).json({ error: 'That account is no longer available. Choose another account.' });
    req.actor = req.user;
    req.user = { ...target, role: 'admin', adminContext: true, actorId: req.actor.id };
    return next();
  } catch {
    return res.status(401).json({ error: 'Admin view expired. Select the account again.' });
  }
}
const requireAdmin = (req, res, next) => (req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admins only.' }));

function validate({ email, name, password }) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return 'Enter a valid email address.';
  if (!name || !String(name).trim()) return 'Enter your name.';
  if (!password || String(password).length < 8) return 'Use a password of at least 8 characters.';
  return null;
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, validate: { xForwardedForHeader: false } });
const inviteHash = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

// Demo login (opt-in via env). The account is created — or its password reset to
// the configured one — at boot, and becomes admin if it is the first account.
const demo = DEMO_LOGIN_EMAIL && DEMO_LOGIN_PASSWORD ? { email: DEMO_LOGIN_EMAIL, password: DEMO_LOGIN_PASSWORD } : null;
if (demo) {
  const hash = bcrypt.hashSync(demo.password, 12);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(demo.email);
  if (u) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, u.id);
  else db.prepare('INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,?)').run(demo.email, 'Demo', hash, userCount() === 0 ? 'admin' : 'user');
  console.log(`[lord-minds] demo login enabled for ${demo.email}`);
}

router.get('/status', (req, res) => {
  res.json({ needsSetup: userCount() === 0, user: publicUser(userFromToken(req.cookies?.[COOKIE_NAME])), demoLogin: demo });
});

router.post('/setup', authLimiter, (req, res) => {
  if (userCount() > 0) return res.status(409).json({ error: 'Lord Minds is already set up. Sign in instead.' });
  const err = validate(req.body || {});
  if (err) return res.status(400).json({ error: err });
  const { email, name, password } = req.body;
  const hash = bcrypt.hashSync(String(password), 12);
  // Re-check inside the write so two simultaneous first visitors cannot both become admin.
  const create = db.transaction(() => {
    if (userCount() > 0) return null;
    const r = db.prepare(`INSERT INTO users (email, name, password_hash, role) VALUES (?,?,?,'admin')`).run(String(email).trim(), String(name).trim(), hash);
    return db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  });
  const user = create();
  if (!user) return res.status(409).json({ error: 'Lord Minds is already set up. Sign in instead.' });
  issue(res, req, user);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const u = email && db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) return res.status(401).json({ error: 'Wrong email or password.' });
  issue(res, req, u);
  res.json({ user: publicUser(u) });
});

// Invitation details are public so the invited person can see which address
// the single-use link was issued for. The token itself is never stored in DB.
router.get('/invites/:token', authLimiter, (req, res) => {
  const invite = db.prepare('SELECT email, role, expires_at FROM user_invites WHERE token_hash = ?').get(inviteHash(req.params.token));
  if (!invite || invite.expires_at <= Date.now()) return res.status(404).json({ error: 'This invitation is invalid or has expired. Ask an admin for a new invite.' });
  res.json({ email: invite.email, role: invite.role, expiresAt: invite.expires_at });
});

router.post('/invites/accept', authLimiter, (req, res) => {
  const { token, name, password } = req.body || {};
  if (!token || !name || !String(name).trim()) return res.status(400).json({ error: 'Enter your name.' });
  if (!password || String(password).length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
  const accept = db.transaction(() => {
    const invite = db.prepare('SELECT * FROM user_invites WHERE token_hash = ?').get(inviteHash(token));
    if (!invite || invite.expires_at <= Date.now()) return { error: 'This invitation is invalid or has expired. Ask an admin for a new invite.' };
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(invite.email)) return { error: 'An account already uses this email. Sign in instead.' };
    const created = db.prepare('INSERT INTO users (email, name, password_hash, role, permissions) VALUES (?,?,?,?,?)')
      .run(invite.email, String(name).trim(), bcrypt.hashSync(String(password), 12), invite.role, invite.permissions);
    db.prepare('DELETE FROM user_invites WHERE id = ?').run(invite.id);
    return { user: db.prepare('SELECT * FROM users WHERE id = ?').get(created.lastInsertRowid) };
  });
  const result = accept();
  if (result.error) return res.status(400).json({ error: result.error });
  issue(res, req, result.user);
  res.status(201).json({ user: publicUser(result.user) });
});

router.post('/logout', (req, res) => { res.clearCookie(COOKIE_NAME, { path: '/' }); res.json({ ok: true }); });

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.put('/me', requireAuth, (req, res) => {
  const { name, currentPassword, newPassword } = req.body || {};
  if (name && String(name).trim()) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), req.user.id);
  if (newPassword) {
    if (!bcrypt.compareSync(String(currentPassword || ''), req.user.password_hash)) return res.status(400).json({ error: 'Your current password is not right.' });
    if (String(newPassword).length < 8) return res.status(400).json({ error: 'Use a password of at least 8 characters.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 12), req.user.id);
  }
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

// ── admin: people and single-use invitations ──
router.get('/users', requireAuth, requireAdmin, (req, res) => {
  res.json({ users: db.prepare('SELECT id, email, name, role, permissions, created_at FROM users ORDER BY id').all().map(publicUser) });
});
router.post('/admin-context', requireAuth, requireAdmin, (req, res) => {
  const targetId = Number(req.body?.targetId);
  if (!Number.isInteger(targetId) || targetId < 1) return res.status(400).json({ error: 'Choose an account to view.' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: 'Account not found.' });
  const token = jwt.sign({ kind: 'admin-context', actorId: req.user.id, targetId }, SESSION_SECRET, { expiresIn: '8h' });
  res.json({ token, user: publicUser(target), expiresIn: 28800 });
});
router.get('/invites', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM user_invites WHERE expires_at <= ?').run(Date.now());
  const invites = db.prepare('SELECT id, email, role, permissions, token_enc, created_at, expires_at FROM user_invites WHERE created_by = ? ORDER BY id DESC').all(req.user.id)
    .map(i => ({ ...i, permissions: normalizePermissions(JSON.parse(i.permissions)), link: `${baseUrl(req)}/#/invite/${decrypt(i.token_enc)}` }));
  res.json({ invites });
});
router.post('/invites', requireAuth, requireAdmin, (req, res) => {
  const { email } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) return res.status(400).json({ error: 'Enter a valid email address.' });
  const cleanEmail = String(email).trim().toLowerCase();
  const role = req.body.role === 'admin' ? 'admin' : 'user';
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(cleanEmail)) return res.status(409).json({ error: 'Someone already has an account with that email.' });
  db.prepare('DELETE FROM user_invites WHERE expires_at <= ?').run(Date.now());
  if (db.prepare('SELECT 1 FROM user_invites WHERE email = ?').get(cleanEmail)) return res.status(409).json({ error: 'An active invitation already exists for that email.' });
  const token = randomToken(32);
  const expiresAt = Date.now() + 7 * 24 * 3600 * 1000;
  try {
    const r = db.prepare('INSERT INTO user_invites (token_hash, token_enc, email, role, permissions, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(inviteHash(token), encrypt(token), cleanEmail, role, JSON.stringify(normalizePermissions(req.body.permissions)), req.user.id, Date.now(), expiresAt);
    res.status(201).json({ invite: { id: Number(r.lastInsertRowid), email: cleanEmail, role, expiresAt, link: `${baseUrl(req)}/#/invite/${token}` } });
  } catch (e) {
    if (/UNIQUE/.test(e.message)) return res.status(409).json({ error: 'An active invitation already exists for that email.' });
    throw e;
  }
});
router.delete('/invites/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM user_invites WHERE id = ? AND created_by = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});
router.patch('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (id === req.user.id) return res.status(400).json({ error: 'Admin access cannot be limited from this screen.' });
  const permissions = normalizePermissions(req.body?.permissions);
  db.prepare('UPDATE users SET permissions = ? WHERE id = ?').run(JSON.stringify(permissions), id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
});
router.delete('/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = { router, requireAuth, requireAdmin, workspaceContext, userFromToken };
