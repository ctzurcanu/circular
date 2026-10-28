-- The web app goes through the authenticated Edge handler, never direct table/RPC
-- access with a browser key. The function's private SQL connection uses an owner
-- or dedicated BYPASSRLS backend role. No browser credential can impersonate actors.
DO $$
DECLARE table_name text; role_name text; signature text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['locale','ontology_node','edge_type','ontology_edge','node_name',
    'tag_kind','tag','tag_name','node_tag','node_proposal','translation_job','org_invite','connection_request',
    'business','individual','business_representative','product_service','business_input','business_output',
    'ontology_collection','catalog_release','ontology_node_source','ontology_node_alias',
    'catalog_property_synonym','catalog_graph_state','business_listing'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
      END IF;
    END LOOP;
  END LOOP;
  FOREACH table_name IN ARRAY ARRAY['business_catalog','published_business_catalog','catalog_ancestor'] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',table_name);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',table_name,role_name);
      END IF;
    END LOOP;
  END LOOP;
  FOR signature IN SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('create_business_listing','set_listing_state','match_businesses',
      'search_catalog','refresh_catalog_ancestor') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',signature);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
