-- Metro sales, one row per Metro, product and week (the last 26 weeks), and
-- the weekly replenishment orders decided from them.
CREATE TABLE IF NOT EXISTS metro_sales (
 user_id TEXT PRIMARY KEY, document TEXT NOT NULL, imported_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metro_orders (
 user_id TEXT NOT NULL, week TEXT NOT NULL, document TEXT NOT NULL, saved_at TEXT NOT NULL,
 PRIMARY KEY (user_id, week)
);
