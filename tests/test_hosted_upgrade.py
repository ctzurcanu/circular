"""Check the original hosted-schema upgrade in a disposable local database."""
from pathlib import Path
import subprocess
import uuid


def main():
    root = Path(__file__).resolve().parents[1]
    database = 'circular_upgrade_check_' + uuid.uuid4().hex[:8]
    base = (root / 'schema.sql').read_text().split(
        '-- psql resolves this path relative to this schema file.'
    )[0]
    legacy = """
UPDATE public.locale SET locale = 'en' WHERE locale = 'us_en';
ALTER TABLE public.node_name ALTER COLUMN locale DROP DEFAULT;
CREATE FUNCTION public.require_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.node_kind <> 'root' AND NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'Legacy parent constraint';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER ontology_node_require_parent
AFTER INSERT OR UPDATE ON public.ontology_node DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.require_parent();
CREATE UNIQUE INDEX node_sibling_slug_idx ON public.ontology_node(parent_id,slug)
NULLS NOT DISTINCT;
CREATE INDEX node_name_search_idx ON public.node_name
USING gin(to_tsvector('simple',name));
INSERT INTO public.edge_type(code,name,is_hierarchy) VALUES ('related','Related to',false);
INSERT INTO public.ontology_node(slug,node_kind) VALUES ('legacy-root','root');
INSERT INTO public.node_name(node_id,locale,name,source)
SELECT node_id,'en','Existing root','human' FROM public.ontology_node;
"""
    assertions = """
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.node_name WHERE locale='en' AND name='Existing root')
     OR NOT EXISTS(SELECT 1 FROM public.node_name WHERE locale='us_en' AND name='Existing root') THEN
    RAISE EXCEPTION 'Legacy English labels were not preserved and copied';
  END IF;
END $$;
"""
    upgrade = '\n'.join(p.read_text() for p in sorted((root / 'migrations').glob('*.sql')))
    subprocess.run(['createdb', '-h', 'localhost', database], check=True)
    try:
        psql = ['psql', '-X', '-h', 'localhost', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q']
        subprocess.run(psql, input=base + legacy + upgrade + assertions, text=True, check=True)
        subprocess.run(psql + ['-f', str(root / 'tests/business_graph.sql')], check=True)
        print('Legacy hosted upgrade and business-graph checks passed.')
    finally:
        subprocess.run(['dropdb', '-h', 'localhost', database], check=True)


if __name__ == '__main__':
    main()
