CREATE TABLE IF NOT EXISTS payment_requests (
  slug TEXT PRIMARY KEY,
  tag TEXT NOT NULL,
  amount TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL
);
