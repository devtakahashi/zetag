CREATE TABLE IF NOT EXISTS ping_read_positions (
  reader TEXT NOT NULL,
  peer TEXT NOT NULL,
  last_id INTEGER NOT NULL,
  PRIMARY KEY (reader, peer)
);
