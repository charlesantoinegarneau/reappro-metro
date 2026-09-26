-- Invoices « Commande interne » delivered to the Metros (read from the PDF),
-- matched to Metro's barcodes. Re-importing an invoice replaces it.
CREATE TABLE IF NOT EXISTS metro_invoices (
 user_id TEXT NOT NULL, number TEXT NOT NULL, metro TEXT NOT NULL, invoice_date TEXT NOT NULL,
 document TEXT NOT NULL, imported_at TEXT NOT NULL,
 PRIMARY KEY (user_id, number)
);
