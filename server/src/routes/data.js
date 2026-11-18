// What the office cards read, plus the direct actions a PERSON takes from them
// (tick a task, add an event, reply in a chat). These are user clicks, not the
// assistant — the assistant can only prepare drafts.
const express = require('express');
const db = require('../db');
const store = require('../store');
const bus = require('../bus');
const google = require('../integrations/google');
const msg = require('../integrations/messaging');
const { chatRow } = require('../assistant/tools');
const actions = require('../assistant/actions');
const { can, permissionsFor, requirePermission } = require('../permissions');
const n8n = require('../integrations/n8n');

const router = express.Router();
const CONTACT_STAGES = new Set(['new', 'contacted', 'qualified', 'won', 'lost']);
const contactRow = (c) => ({ ...c, tags: JSON.parse(c.tags || '[]'), whatsapp_opt_in: !!c.whatsapp_opt_in });
const contactFollowUp = (value) => {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toISOString();
};

// Wrap async handlers; Google "not connected" becomes a 409 the cards render as a prompt.
const h = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) {
    const status = e instanceof google.GoogleNotConnected ? 409 : (e.status || 400);
    res.status(status).json({ error: e.message, notConnected: e instanceof google.GoogleNotConnected });
  }
};

router.get('/n8n/workflows', requirePermission('n8n'), h(async (req, res) => res.json(await n8n.list(req.user.id))));

router.get('/office/status', (req, res) => {
  const k = (kind) => store.get(req.user.id, kind);
  const m = k('model'); const v = k('voice'); const g = k('google'); const w = k('whatsapp'); const t = k('telegram');
  res.json({
    model: !!m.secret.apiKey, modelName: m.config.model || null, provider: m.config.provider || null,
    voice: can(req.user, 'voice') && !!v.secret.apiKey,
    google: can(req.user, 'google') && !!g.secret.refreshToken && g.status === 'connected', googleExpired: g.status === 'expired',
    whatsapp: can(req.user, 'whatsapp') && !!w.secret.accessToken, telegram: can(req.user, 'telegram') && !!t.secret.botToken,
    write: can(req.user, 'write'), assistant: can(req.user, 'assistant'), permissions: permissionsFor(req.user),
  });
});

// ── CRM contacts ──
router.get('/contacts', requirePermission('crm'), (req, res) => {
  const query = String(req.query.q || '').trim().slice(0, 100).toLowerCase();
  const rows = db.prepare('SELECT * FROM contacts WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 500').all(req.user.id);
  const contacts = rows.filter(c => !query || [c.name, c.email, c.phone, c.company, c.source, c.notes, c.tags].some(v => String(v || '').toLowerCase().includes(query))).map(contactRow);
  res.json({ contacts });
});
router.post('/contacts', requirePermission('crm'), requirePermission('write'), (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 160);
  if (!name) return res.status(400).json({ error: 'Give the contact a name.' });
  const stage = CONTACT_STAGES.has(req.body.stage) ? req.body.stage : 'new';
  const tags = Array.isArray(req.body.tags) ? [...new Set(req.body.tags.map(x => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 20) : [];
  const followUpAt = contactFollowUp(req.body.followUpAt);
  if (followUpAt === undefined) return res.status(400).json({ error: 'Choose a valid follow-up date.' });
  const whatsAppOptIn = req.body.whatsappOptIn ? 1 : 0;
  let chatId = req.body.chatId == null ? null : Number(req.body.chatId);
  if (chatId && !db.prepare('SELECT 1 FROM chats WHERE id = ? AND user_id = ?').get(chatId, req.user.id)) return res.status(404).json({ error: 'Chat not found.' });
  const r = db.prepare('INSERT INTO contacts (user_id, chat_id, name, email, phone, company, stage, source, tags, notes, follow_up_at, whatsapp_opt_in) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, chatId, name, String(req.body.email || '').trim().slice(0, 254) || null, String(req.body.phone || '').trim().slice(0, 40) || null,
      String(req.body.company || '').trim().slice(0, 160) || null, stage, String(req.body.source || '').trim().slice(0, 100) || null, JSON.stringify(tags), String(req.body.notes || '').slice(0, 4000), followUpAt, whatsAppOptIn);
  res.status(201).json({ contact: contactRow(db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(r.lastInsertRowid, req.user.id)) });
});
router.patch('/contacts/:id', requirePermission('crm'), requirePermission('write'), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(id, req.user.id);
  if (!current) return res.status(404).json({ error: 'Contact not found.' });
  const b = req.body || {};
  const name = b.name === undefined ? current.name : String(b.name).trim().slice(0, 160);
  if (!name) return res.status(400).json({ error: 'Give the contact a name.' });
  const stage = b.stage === undefined ? current.stage : (CONTACT_STAGES.has(b.stage) ? b.stage : null);
  if (!stage) return res.status(400).json({ error: 'Choose a valid stage.' });
  const tags = b.tags === undefined ? current.tags : JSON.stringify(Array.isArray(b.tags) ? [...new Set(b.tags.map(x => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 20) : []);
  const followUpAt = b.followUpAt === undefined ? current.follow_up_at : contactFollowUp(b.followUpAt);
  if (followUpAt === undefined) return res.status(400).json({ error: 'Choose a valid follow-up date.' });
  const whatsAppOptIn = b.whatsappOptIn === undefined ? current.whatsapp_opt_in : (b.whatsappOptIn ? 1 : 0);
  let chatId = b.chatId === undefined ? current.chat_id : (b.chatId == null ? null : Number(b.chatId));
  if (chatId && !db.prepare('SELECT 1 FROM chats WHERE id = ? AND user_id = ?').get(chatId, req.user.id)) return res.status(404).json({ error: 'Chat not found.' });
  db.prepare(`UPDATE contacts SET chat_id=?,name=?,email=?,phone=?,company=?,stage=?,source=?,tags=?,notes=?,follow_up_at=?,whatsapp_opt_in=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(chatId, name, b.email === undefined ? current.email : String(b.email).trim().slice(0, 254) || null,
      b.phone === undefined ? current.phone : String(b.phone).trim().slice(0, 40) || null,
      b.company === undefined ? current.company : String(b.company).trim().slice(0, 160) || null, stage,
      b.source === undefined ? current.source : String(b.source).trim().slice(0, 100) || null, tags,
      b.notes === undefined ? current.notes : String(b.notes).slice(0, 4000), followUpAt, whatsAppOptIn, id, req.user.id);
  res.json({ contact: contactRow(db.prepare('SELECT * FROM contacts WHERE id = ? AND user_id = ?').get(id, req.user.id)) });
});
router.delete('/contacts/:id', requirePermission('crm'), requirePermission('write'), (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ? AND user_id = ?').run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ── tasks ──
router.get('/tasks', requirePermission('google'), h(async (req, res) => res.json(await google.listTasks(req.user.id, { showCompleted: true }))));
router.post('/tasks', requirePermission('google'), requirePermission('write'), h(async (req, res) => {
  if (!String(req.body?.title || '').trim()) return res.status(400).json({ error: 'Give the task a title.' });
  res.status(201).json(await google.createTask(req.user.id, req.body));
}));
router.patch('/tasks/:listId/:taskId', requirePermission('google'), requirePermission('write'), h(async (req, res) => res.json(await google.updateTask(req.user.id, req.params.listId, req.params.taskId, req.body || {}))));
router.delete('/tasks/:listId/:taskId', requirePermission('google'), requirePermission('write'), h(async (req, res) => { await google.deleteTask(req.user.id, req.params.listId, req.params.taskId); res.json({ ok: true }); }));

// ── calendar ──
router.get('/calendar', requirePermission('google'), h(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : undefined;
  const to = req.query.to ? new Date(String(req.query.to)) : undefined;
  res.json({ events: await google.listEvents(req.user.id, { from, to, max: 150 }) });
}));
router.post('/calendar', requirePermission('google'), requirePermission('write'), h(async (req, res) => {
  if (!String(req.body?.title || '').trim()) return res.status(400).json({ error: 'Give the event a title.' });
  res.status(201).json(await google.createEvent(req.user.id, req.body));
}));

// ── mail ──
router.get('/mail', requirePermission('google'), h(async (req, res) => res.json({ messages: await google.listMail(req.user.id, { q: String(req.query.q || 'in:inbox'), max: Number(req.query.max) || 20 }) })));
router.get('/mail/:id', requirePermission('google'), h(async (req, res) => res.json(await google.readMail(req.user.id, req.params.id))));
router.post('/mail/send', requirePermission('google'), requirePermission('write'), h(async (req, res) => {
  const { to, subject, body, replyToId } = req.body || {};
  if (!String(body || '').trim()) return res.status(400).json({ error: 'The email is empty.' });
  res.json(await google.sendMail(req.user.id, { to, subject, body, replyToId }));
}));

// ── chats ──
router.get('/chats', (req, res) => {
  if (!can(req.user, 'whatsapp') && !can(req.user, 'telegram')) return res.status(403).json({ error: 'Your account does not have access to chats.' });
  const rows = db.prepare('SELECT * FROM chats WHERE user_id = ? ORDER BY COALESCE(last_at, \'\') DESC LIMIT 300').all(req.user.id);
  res.json({ chats: rows.filter(c => can(req.user, c.channel)).map(chatRow) });
});
router.get('/chats/:id/messages', (req, res) => {
  const c = db.prepare('SELECT * FROM chats WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!c || !can(req.user, c.channel)) return res.status(404).json({ error: 'Chat not found.' });
  db.prepare('UPDATE chats SET unread = 0 WHERE id = ?').run(c.id);
  const messages = db.prepare('SELECT id, direction, kind, text, status, at FROM chat_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 200').all(c.id).reverse();
  res.json({ chat: chatRow({ ...c, unread: 0 }), messages });
});
router.post('/chats/:id/send', requirePermission('write'), h(async (req, res) => {
  const c = db.prepare('SELECT channel FROM chats WHERE id = ? AND user_id = ?').get(Number(req.params.id), req.user.id);
  if (!c || !can(req.user, c.channel)) return res.status(404).json({ error: 'Chat not found.' });
  const r = await msg.sendToChat(req.user.id, req.params.id, String(req.body?.text || ''));
  bus.emit('chats', req.user.id);
  res.json(r);
}));

// ── drafts (prepared by the assistant) ──
router.get('/actions', (req, res) => {
  const rows = db.prepare(`SELECT * FROM actions WHERE user_id = ? AND (status = 'pending' OR decided_at > datetime('now','-1 day')) ORDER BY id DESC LIMIT 50`).all(req.user.id);
  const allowed = rows.filter(a => {
    if (['email', 'email_reply', 'calendar_event', 'task', 'task_done'].includes(a.kind)) return can(req.user, 'google');
    if (a.kind === 'chat_message') {
      const chatId = JSON.parse(a.payload).chatId;
      const chat = db.prepare('SELECT channel FROM chats WHERE id = ? AND user_id = ?').get(chatId, req.user.id);
      return !!chat && can(req.user, chat.channel);
    }
    return false;
  });
  res.json({ actions: allowed.map(a => ({ ...a, payload: JSON.parse(a.payload), result: a.result ? JSON.parse(a.result) : null })) });
});
router.post('/actions/:id/confirm', requirePermission('write'), h(async (req, res) => {
  const action = db.prepare('SELECT kind, payload FROM actions WHERE id = ? AND user_id = ? AND status = \'pending\'').get(Number(req.params.id), req.user.id);
  if (!action) return res.status(404).json({ error: 'Draft not found.' });
  const permission = action.kind.startsWith('email') || action.kind === 'calendar_event' || action.kind === 'task' || action.kind === 'task_done'
    ? 'google' : action.kind === 'chat_message'
      ? db.prepare('SELECT channel FROM chats WHERE id = ? AND user_id = ?').get(JSON.parse(action.payload).chatId, req.user.id)?.channel
      : null;
  if (permission && !can(req.user, permission)) return res.status(403).json({ error: `Your account does not have access to ${permission}. Ask an admin to change your access.` });
  if (action.kind === 'chat_message' && !permission) return res.status(404).json({ error: 'Chat not found.' });
  const out = await actions.execute(req.user.id, req.params.id, req.body?.edits);
  bus.emit('chats', req.user.id);
  res.json(out);
}));
router.post('/actions/:id/discard', (req, res) => {
  db.prepare(`UPDATE actions SET status = 'discarded', decided_at = datetime('now') WHERE id = ? AND user_id = ? AND status = 'pending'`).run(Number(req.params.id), req.user.id);
  res.json({ ok: true });
});

// ── live updates (new chat messages) ──
router.get('/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('event: hello\ndata: {}\n\n');
  const onChats = (uid) => { if (uid === req.user.id) res.write('event: chats\ndata: {}\n\n'); };
  bus.on('chats', onChats);
  const ka = setInterval(() => res.write(': ka\n\n'), 25000);
  req.on('close', () => { clearInterval(ka); bus.off('chats', onChats); });
});

module.exports = router;
