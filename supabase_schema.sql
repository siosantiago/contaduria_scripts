-- Copy and paste this into the Supabase SQL Editor

-- 1. Table: invoices
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file TEXT,
    emisor_rfc TEXT,
    emisor_nombre TEXT,
    receptor_rfc TEXT,
    receptor_nombre TEXT,
    subtotal NUMERIC,
    descuento NUMERIC,
    total NUMERIC,
    moneda TEXT,
    tipo_cambio NUMERIC,
    version TEXT,
    serie TEXT,
    folio TEXT,
    fecha TIMESTAMP WITH TIME ZONE,
    sello TEXT,
    forma_pago TEXT,
    no_certificado TEXT,
    certificado TEXT,
    tipo_de_comprobante TEXT,
    exportacion TEXT,
    metodo_pago TEXT,
    lugar_expedicion TEXT,
    sello_sat TEXT,
    raw_data JSONB,
    owner_id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure owner_id column exists and columns for metadata
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='invoices' AND COLUMN_NAME='owner_id') THEN
        ALTER TABLE public.invoices ADD COLUMN owner_id UUID;
    END IF;
    
    -- New columns
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='invoices' AND COLUMN_NAME='version') THEN
        ALTER TABLE public.invoices ADD COLUMN version TEXT;
        ALTER TABLE public.invoices ADD COLUMN serie TEXT;
        ALTER TABLE public.invoices ADD COLUMN sello TEXT;
        ALTER TABLE public.invoices ADD COLUMN forma_pago TEXT;
        ALTER TABLE public.invoices ADD COLUMN no_certificado TEXT;
        ALTER TABLE public.invoices ADD COLUMN certificado TEXT;
        ALTER TABLE public.invoices ADD COLUMN subtotal NUMERIC;
        ALTER TABLE public.invoices ADD COLUMN descuento NUMERIC;
        ALTER TABLE public.invoices ADD COLUMN moneda TEXT;
        ALTER TABLE public.invoices ADD COLUMN tipo_cambio NUMERIC;
        ALTER TABLE public.invoices ADD COLUMN tipo_de_comprobante TEXT;
        ALTER TABLE public.invoices ADD COLUMN exportacion TEXT;
        ALTER TABLE public.invoices ADD COLUMN metodo_pago TEXT;
        ALTER TABLE public.invoices ADD COLUMN lugar_expedicion TEXT;
        ALTER TABLE public.invoices ADD COLUMN sello_sat TEXT;
    END IF;
END $$;

-- Enforce owner_id NOT NULL for stability
ALTER TABLE public.invoices ALTER COLUMN owner_id SET NOT NULL;


-- Basic indexes for fast querying
-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_folio ON public.invoices(folio);
CREATE INDEX IF NOT EXISTS idx_invoices_emisor_rfc ON public.invoices(emisor_rfc);
CREATE INDEX IF NOT EXISTS idx_invoices_receptor_rfc ON public.invoices(receptor_rfc);
CREATE INDEX IF NOT EXISTS idx_invoices_fecha ON public.invoices(fecha);

-- Enable Row Level Security (RLS)
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Policy defining that a user can only read their own invoices
-- 4. Policies (Drop first to avoid "already exists" errors)
DROP POLICY IF EXISTS "Users can view their own invoices" ON public.invoices;
CREATE POLICY "Users can view their own invoices" ON public.invoices
    FOR SELECT USING (auth.uid() = owner_id OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can insert their own invoices" ON public.invoices;
CREATE POLICY "Users can insert their own invoices" ON public.invoices
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can update their own invoices" ON public.invoices;
CREATE POLICY "Users can update their own invoices" ON public.invoices
    FOR UPDATE USING (auth.uid() = owner_id OR owner_id IS NULL);

DROP POLICY IF EXISTS "Users can delete their own invoices" ON public.invoices;
CREATE POLICY "Users can delete their own invoices" ON public.invoices
    FOR DELETE USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Service role has full access" ON public.invoices;
CREATE POLICY "Service role has full access" ON public.invoices
    FOR ALL USING (auth.role() = 'service_role');

-- 5. Table: upload_history
CREATE TABLE IF NOT EXISTS public.upload_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    total_files INTEGER NOT NULL,
    inserted INTEGER NOT NULL,
    errors JSONB DEFAULT '[]'::jsonb,
    owner_id UUID NOT NULL
);

ALTER TABLE public.upload_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own upload history" ON public.upload_history;
CREATE POLICY "Users can view their own upload history" ON public.upload_history
    FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can insert their own upload history" ON public.upload_history;
CREATE POLICY "Users can insert their own upload history" ON public.upload_history
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can delete their own upload history" ON public.upload_history;
CREATE POLICY "Users can delete their own upload history" ON public.upload_history
    FOR DELETE USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Service role has full access to history" ON public.upload_history;
CREATE POLICY "Service role has full access to history" ON public.upload_history
    FOR ALL USING (auth.role() = 'service_role');
