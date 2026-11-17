CREATE TABLE IF NOT EXISTS profiles (
  tag TEXT PRIMARY KEY,
  wallet TEXT NOT NULL UNIQUE,
  avatar TEXT NOT NULL DEFAULT '',
  joined_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_challenges (
  nonce TEXT PRIMARY KEY,
  wallet TEXT NOT NULL,
  tag TEXT NOT NULL,
  avatar TEXT NOT NULL,
  message TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS profile_challenges_expires ON profile_challenges (expires);
