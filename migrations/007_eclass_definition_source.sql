-- Allow class descriptions collected from eclass.eu release 16.0.
-- The local taxonomy is ECLASS 10.0.1; wording may reflect the newer release.
ALTER TABLE public.node_name DROP CONSTRAINT IF EXISTS node_name_source_check;
ALTER TABLE public.node_name ADD CONSTRAINT node_name_source_check
  CHECK (source = ANY (ARRAY['human'::text, 'machine'::text, 'imported'::text, 'eclass.eu-16.0'::text]));
