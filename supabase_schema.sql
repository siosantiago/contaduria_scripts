-- Copy and paste this into the Supabase SQL Editor

CREATE TABLE public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file TEXT,
    folio TEXT,
    fecha TIMESTAMP WITH TIME ZONE,
    emisor_rfc TEXT,
    emisor_nombre TEXT,
    receptor_rfc TEXT,
    receptor_nombre TEXT,
    total NUMERIC,
    raw_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Basic indexes for fast querying
CREATE INDEX idx_invoices_folio ON public.invoices(folio);
CREATE INDEX idx_invoices_emisor_rfc ON public.invoices(emisor_rfc);
CREATE INDEX idx_invoices_receptor_rfc ON public.invoices(receptor_rfc);
CREATE INDEX idx_invoices_fecha ON public.invoices(fecha);
