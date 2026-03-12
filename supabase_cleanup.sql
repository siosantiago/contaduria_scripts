-- RUN THIS SCRIPT ONCE TO CLEAN UP OLD DATA AND ENFORCE OWNERSHIP
-- 1. Delete all existing records
TRUNCATE public.invoices;
TRUNCATE public.upload_history;

-- 2. Enforce that owner_id cannot be null for future records
-- This ensures strict security where every invoice MUST belong to a user.
ALTER TABLE public.invoices ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.upload_history ALTER COLUMN owner_id SET NOT NULL;

-- 3. Cleanup is done. Now run the updated supabase_schema.sql to add new columns.
