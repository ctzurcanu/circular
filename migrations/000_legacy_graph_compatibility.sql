-- The original hosted schema required every non-root node to have one parent
-- and made slugs unique within that legacy parent_id. The business graph uses
-- relation edges, permits standalone businesses, and scopes Other by collection.
-- Keep existing nodes/edges and remove only these superseded restrictions.
DROP TRIGGER IF EXISTS ontology_node_require_parent ON public.ontology_node;
DROP INDEX IF EXISTS public.node_sibling_slug_idx;

-- Hosted names originally required callers to pass the locale explicitly.
-- Preserve the existing source locale and any already translated labels.
INSERT INTO public.locale (locale, display_name, dir, is_active, is_source, fallback)
VALUES ('us_en', 'English (United States)', 'ltr', true, false,
  (SELECT locale FROM public.locale WHERE locale = 'en'))
ON CONFLICT (locale) DO NOTHING;
INSERT INTO public.node_name (node_id, locale, name, description, source, status)
SELECT node_id, 'us_en', name, description, source, status
FROM public.node_name WHERE locale = 'en'
ON CONFLICT (node_id, locale) DO NOTHING;
ALTER TABLE public.node_name ALTER COLUMN locale SET DEFAULT 'us_en';
