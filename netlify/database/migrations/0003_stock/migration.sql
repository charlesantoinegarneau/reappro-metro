-- Shelf stock of each Metro (replenishment export of the Shopify tool),
-- matched to Metro's barcodes. A new file replaces the Metro's previous one.
CREATE TABLE IF NOT EXISTS metro_stock (
 user_id TEXT NOT NULL, metro TEXT NOT NULL, document TEXT NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY (user_id, metro)
);
