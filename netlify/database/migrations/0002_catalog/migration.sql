-- Shopify product catalog (brand, product and variant by barcode), used to
-- sort the order sheet. A new export replaces the previous one.
CREATE TABLE IF NOT EXISTS metro_catalog (
 user_id TEXT PRIMARY KEY, document TEXT NOT NULL, imported_at TEXT NOT NULL
);
