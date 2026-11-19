CREATE TABLE IF NOT EXISTS payment_request_assets (
  slug TEXT PRIMARY KEY,
  asset TEXT NOT NULL CHECK(asset IN ('USDC', 'SOL'))
);
