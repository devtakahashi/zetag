CREATE TABLE IF NOT EXISTS profile_bios (
  wallet TEXT PRIMARY KEY,
  bio TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_sessions (
  token_hash TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS profile_sessions_expires ON profile_sessions (expires);

CREATE TABLE IF NOT EXISTS ping_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ping_messages_sender ON ping_messages (sender, recipient, id);
CREATE INDEX IF NOT EXISTS ping_messages_recipient ON ping_messages (recipient, sender, id);

CREATE TABLE IF NOT EXISTS profile_tag_aliases (
  tag TEXT PRIMARY KEY,
  wallet TEXT NOT NULL
);
