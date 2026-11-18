const express = require('express');
const db = require('../db');
const store = require('../store');
const msg = require('../integrations/messaging');
const { requirePermission, can } = require('../permissions');

const router = express.Router();
const phoneDigits = value => String(value || '').replace(/\D/g, '');
const campaignSummary = (campaign) => {
  const counts = db.prepare(`SELECT COUNT(*) total,SUM(status='sent') sent,SUM(status='failed') failed,SUM(status IN ('queued','sending')) pending FROM broadcast_recipients WHERE broadcast_id=?`).get(campaign.id);
  return { ...campaign, parameters: JSON.parse(campaign.parameters || '[]'), counts: { total: counts.total, sent: counts.sent || 0, failed: counts.failed || 0, pending: counts.pending || 0 } };
};

router.get('/broadcasts', requirePermission('flows'), requirePermission('crm'), (req, res) => {
  const contacts = db.prepare(`SELECT id,name,phone FROM contacts WHERE user_id=? AND whatsapp_opt_in=1 AND phone IS NOT NULL AND trim(phone)<>'' ORDER BY name LIMIT 1000`).all(req.user.id);
  const campaigns = db.prepare(`SELECT * FROM broadcasts WHERE user_id=? ORDER BY id DESC LIMIT 50`).all(req.user.id).map(campaignSummary);
  res.json({ contacts, campaigns, whatsappConnected: can(req.user, 'whatsapp') && !!store.get(req.user.id, 'whatsapp').secret.accessToken });
});

router.get('/broadcasts/:id', requirePermission('flows'), requirePermission('crm'), (req, res) => {
  const campaign = db.prepare('SELECT * FROM broadcasts WHERE id=? AND user_id=?').get(Number(req.params.id), req.user.id);
  if (!campaign) return res.status(404).json({ error: 'Broadcast not found.' });
  const recipients = db.prepare('SELECT name,phone,status,external_id,error,updated_at FROM broadcast_recipients WHERE broadcast_id=? ORDER BY id').all(campaign.id);
  res.json({ campaign: campaignSummary(campaign), recipients });
});

router.post('/broadcasts', requirePermission('flows'), requirePermission('crm'), requirePermission('write'), (req, res) => {
  const b = req.body || {};
  const templateName = String(b.templateName || '').trim();
  const language = String(b.language || '').trim();
  const contactIds = Array.isArray(b.contactIds) ? [...new Set(b.contactIds.map(Number))] : [];
  const parameters = Array.isArray(b.parameters) ? b.parameters.map(x => String(x).trim().slice(0, 256)) : [];
  if (!can(req.user, 'whatsapp')) return res.status(403).json({ error: 'This account does not have WhatsApp access.' });
  if (!store.get(req.user.id, 'whatsapp').secret.accessToken) return res.status(409).json({ error: 'Connect WhatsApp in Settings before creating a broadcast.' });
  if (!/^[a-z0-9_]{1,512}$/.test(templateName)) return res.status(400).json({ error: 'Enter the name of an approved WhatsApp template.' });
  if (!/^[a-z]{2,3}(?:_[A-Z]{2,4})?$/.test(language)) return res.status(400).json({ error: 'Enter the template language code, for example en_US.' });
  if (!contactIds.length || contactIds.length > 25 || contactIds.some(id => !Number.isInteger(id) || id < 1)) return res.status(400).json({ error: 'Select between 1 and 25 opted-in contacts per broadcast.' });
  if (parameters.length > 10 || parameters.some(x => !x)) return res.status(400).json({ error: 'Template body parameters must be non-empty and limited to 10.' });
  const contacts = db.prepare(`SELECT id,name,phone,whatsapp_opt_in FROM contacts WHERE user_id=? AND id IN (${contactIds.map(() => '?').join(',')})`).all(req.user.id, ...contactIds);
  if (contacts.length !== contactIds.length) return res.status(400).json({ error: 'One or more selected contacts are not available in this account.' });
  if (contacts.some(c => !c.whatsapp_opt_in || phoneDigits(c.phone).length < 7 || phoneDigits(c.phone).length > 15)) return res.status(400).json({ error: 'Every selected contact must have a valid phone number and explicit WhatsApp opt-in.' });
  const phones = contacts.map(c => phoneDigits(c.phone));
  if (new Set(phones).size !== phones.length) return res.status(400).json({ error: 'Selected contacts contain duplicate phone numbers.' });
  const name = String(b.name || `WhatsApp: ${templateName}`).trim().slice(0, 100) || `WhatsApp: ${templateName}`;
  const create = db.transaction(() => {
    const campaign = db.prepare(`INSERT INTO broadcasts (user_id,name,template_name,language,parameters) VALUES (?,?,?,?,?)`)
      .run(req.user.id, name, templateName, language, JSON.stringify(parameters));
    const insert = db.prepare(`INSERT INTO broadcast_recipients (broadcast_id,contact_id,name,phone) VALUES (?,?,?,?)`);
    contacts.forEach((contact, index) => insert.run(campaign.lastInsertRowid, contact.id, contact.name, phones[index]));
    return Number(campaign.lastInsertRowid);
  });
  const id = create();
  res.status(202).json({ campaignId: id, status: 'queued' });
  setImmediate(() => msg.startBroadcast(id));
});

module.exports = router;
