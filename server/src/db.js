// SQLite — one file in the data volume. Schema is created idempotently at boot.
const path = require('path');
const Database = require('better-sqlite3');
const { DATA_DIR } = require('./config');

const db = new Database(path.join(DATA_DIR, 'openforge.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  permissions   TEXT NOT NULL DEFAULT '{"assistant":true,"crm":true,"google":true,"whatsapp":true,"messenger":true,"telegram":true,"n8n":true,"flows":true,"instagram":true,"youtube":true,"voice":true,"write":true}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT NOT NULL UNIQUE,
  token_enc   TEXT NOT NULL,
  email       TEXT NOT NULL COLLATE NOCASE,
  role        TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
  permissions TEXT NOT NULL DEFAULT '{}',
  created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_user_invites_email ON user_invites(email);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_invite_email ON user_invites(email COLLATE NOCASE);

-- One row per user per integration. Secret values live in secret_enc
-- (AES-256-GCM JSON); non-secret config in config (plain JSON).
CREATE TABLE IF NOT EXISTS integrations (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,          -- model | voice | google | whatsapp | telegram
  config     TEXT NOT NULL DEFAULT '{}',
  secret_enc TEXT,
  hook_id    TEXT UNIQUE,            -- public, unguessable id used in webhook URLs
  status     TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE IF NOT EXISTS oauth_states (
  state      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('whatsapp','telegram')),
  external_id TEXT NOT NULL,         -- WhatsApp wa_id / Telegram chat id
  name        TEXT,
  last_at     TEXT,
  last_text   TEXT,
  last_inbound_at TEXT,
  unread      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, channel, external_id)
);

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chat_id     INTEGER REFERENCES chats(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  company     TEXT,
  stage       TEXT NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','qualified','won','lost')),
  source      TEXT,
  tags        TEXT NOT NULL DEFAULT '[]',
  notes       TEXT NOT NULL DEFAULT '',
  follow_up_at TEXT,
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (whatsapp_opt_in IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, chat_id)
);
CREATE INDEX IF NOT EXISTS ix_contacts_user_stage ON contacts(user_id, stage, updated_at DESC);

CREATE TABLE IF NOT EXISTS meta_message_flows (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  keywords   TEXT NOT NULL DEFAULT '[]',
  reply_text TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_meta_flows_user ON meta_message_flows(user_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS message_flows (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  channel      TEXT NOT NULL CHECK (channel IN ('whatsapp','telegram','all')),
  keywords     TEXT NOT NULL DEFAULT '[]',
  reply_text   TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 0,
  meta_flow_id INTEGER REFERENCES meta_message_flows(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_message_flows_user_active ON message_flows(user_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS message_flow_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_id      INTEGER REFERENCES message_flows(id) ON DELETE SET NULL,
  channel      TEXT NOT NULL,
  chat_id      INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  external_id  TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('sent','failed')),
  reply_text   TEXT NOT NULL,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, channel, chat_id, external_id)
);
CREATE INDEX IF NOT EXISTS ix_message_flow_runs_user ON message_flow_runs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS broadcasts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  template_name TEXT NOT NULL,
  language      TEXT NOT NULL,
  parameters    TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','complete','partial','failed')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_broadcasts_user ON broadcasts(user_id, id DESC);

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  contact_id   INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  external_id  TEXT,
  error        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (broadcast_id, phone)
);
CREATE INDEX IF NOT EXISTS ix_broadcast_recipients_campaign ON broadcast_recipients(broadcast_id, id);

CREATE TABLE IF NOT EXISTS instagram_comment_flows (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  keywords   TEXT NOT NULL DEFAULT '[]',
  reply_text TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0,
  media_id   TEXT,
  meta_flow_id INTEGER REFERENCES meta_message_flows(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_instagram_flows_user ON instagram_comment_flows(user_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS instagram_flow_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_id    INTEGER REFERENCES instagram_comment_flows(id) ON DELETE SET NULL,
  comment_id TEXT NOT NULL,
  media_id TEXT,
  username   TEXT,
  comment    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL CHECK (status IN ('sent','failed')),
  reply_text TEXT NOT NULL,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS ix_instagram_flow_runs_user ON instagram_flow_runs(user_id, id DESC);

CREATE TABLE IF NOT EXISTS messenger_flow_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_id    INTEGER REFERENCES meta_message_flows(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  sender_id  TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL CHECK (status IN ('sent','failed')),
  reply_text TEXT NOT NULL,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, external_id)
);
CREATE INDEX IF NOT EXISTS ix_messenger_flow_runs_user ON messenger_flow_runs(user_id, id DESC);

CREATE TABLE IF NOT EXISTS youtube_comment_flows (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  keywords   TEXT NOT NULL DEFAULT '[]',
  reply_text TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 0,
  video_id   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_youtube_flows_user ON youtube_comment_flows(user_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS youtube_flow_runs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_id    INTEGER REFERENCES youtube_comment_flows(id) ON DELETE SET NULL,
  comment_id TEXT NOT NULL,
  video_id   TEXT NOT NULL,
  username   TEXT,
  comment    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL CHECK (status IN ('sent','failed')),
  reply_text TEXT NOT NULL,
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, comment_id)
);
CREATE INDEX IF NOT EXISTS ix_youtube_flow_runs_user ON youtube_flow_runs(user_id, id DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  direction   TEXT NOT NULL CHECK (direction IN ('in','out')),
  external_id TEXT,
  kind        TEXT NOT NULL DEFAULT 'text',
  text        TEXT,
  status      TEXT,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_msg_ext ON chat_messages(chat_id, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_chat_msg_chat ON chat_messages(chat_id, id);

CREATE TABLE IF NOT EXISTS conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'New conversation',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT NOT NULL DEFAULT '',
  steps           TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Drafts the assistant PREPARED. Nothing is ever sent until the user presses
-- Send / Confirm on one of these.
CREATE TABLE IF NOT EXISTS actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,         -- chat_message | email | email_reply | calendar_event | task
  title       TEXT NOT NULL,
  payload     TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','discarded','failed')),
  result      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at  TEXT
);
`);

if (!db.pragma('table_info(contacts)').some(c => c.name === 'follow_up_at')) {
  db.exec('ALTER TABLE contacts ADD COLUMN follow_up_at TEXT');
}
if (!db.pragma('table_info(contacts)').some(c => c.name === 'whatsapp_opt_in')) {
  db.exec('ALTER TABLE contacts ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0');
}

// Add permissions to existing installations without disturbing user data.
if (!db.pragma('table_info(users)').some(c => c.name === 'permissions')) {
  db.exec(`ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{"assistant":true,"crm":true,"google":true,"whatsapp":true,"messenger":true,"telegram":true,"n8n":true,"flows":true,"instagram":true,"youtube":true,"voice":true,"write":true}'`);
}

if (!db.pragma('table_info(message_flows)').some(c => c.name === 'meta_flow_id')) db.exec('ALTER TABLE message_flows ADD COLUMN meta_flow_id INTEGER REFERENCES meta_message_flows(id) ON DELETE CASCADE');
if (!db.pragma('table_info(instagram_comment_flows)').some(c => c.name === 'meta_flow_id')) db.exec('ALTER TABLE instagram_comment_flows ADD COLUMN meta_flow_id INTEGER REFERENCES meta_message_flows(id) ON DELETE CASCADE');
if (!db.pragma('table_info(instagram_comment_flows)').some(c => c.name === 'media_id')) db.exec('ALTER TABLE instagram_comment_flows ADD COLUMN media_id TEXT');
if (!db.pragma('table_info(instagram_flow_runs)').some(c => c.name === 'media_id')) db.exec('ALTER TABLE instagram_flow_runs ADD COLUMN media_id TEXT');
if (!db.pragma('table_info(youtube_comment_flows)').some(c => c.name === 'video_id')) db.exec('ALTER TABLE youtube_comment_flows ADD COLUMN video_id TEXT');

module.exports = db;
