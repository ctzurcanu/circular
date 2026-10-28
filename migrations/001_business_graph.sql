-- Apply once, after schema.sql, using psql --single-transaction.
ALTER TABLE public.ontology_node ADD COLUMN is_other boolean NOT NULL DEFAULT false;
ALTER TABLE public.ontology_node ADD CONSTRAINT ontology_node_id_kind_unique UNIQUE (node_id, node_kind);
ALTER TABLE public.ontology_edge ADD CONSTRAINT ontology_edge_unique UNIQUE (source_id, target_id, edge_type_id);
ALTER TABLE public.ontology_edge ADD CONSTRAINT ontology_edge_no_self CHECK (source_id <> target_id);
CREATE INDEX ontology_edge_target_idx ON public.ontology_edge (target_id, edge_type_id);

CREATE TABLE public.business (
  business_id bigint PRIMARY KEY,
  node_kind text NOT NULL DEFAULT 'organization' CHECK (node_kind = 'organization'),
  legal_name text,
  registration_number text,
  registration_country text,
  FOREIGN KEY (business_id, node_kind) REFERENCES public.ontology_node (node_id, node_kind)
);

-- An individual is not required to have a login. Handles mirror ensemble profiles.
CREATE TABLE public.individual (
  individual_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users (id),
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  email text,
  github_handle text,
  x_handle text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.business_representative (
  business_id bigint NOT NULL REFERENCES public.business,
  individual_id uuid NOT NULL REFERENCES public.individual,
  role text NOT NULL DEFAULT 'representative' CHECK (length(btrim(role)) > 0),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, individual_id)
);
CREATE UNIQUE INDEX business_one_primary_rep ON public.business_representative (business_id) WHERE is_primary;
CREATE INDEX business_representative_individual_idx ON public.business_representative (individual_id);

CREATE TABLE public.product_service (
  node_id bigint PRIMARY KEY,
  node_kind text NOT NULL CHECK (node_kind IN ('product', 'service')),
  is_category boolean NOT NULL DEFAULT false,
  FOREIGN KEY (node_id, node_kind) REFERENCES public.ontology_node (node_id, node_kind)
);
CREATE TABLE public.business_input (
  business_id bigint NOT NULL REFERENCES public.business,
  product_service_id bigint NOT NULL REFERENCES public.product_service (node_id),
  notes text,
  PRIMARY KEY (business_id, product_service_id)
);
CREATE INDEX business_input_product_idx ON public.business_input (product_service_id);
CREATE TABLE public.business_output (
  business_id bigint NOT NULL REFERENCES public.business,
  product_service_id bigint NOT NULL REFERENCES public.product_service (node_id),
  notes text,
  PRIMARY KEY (business_id, product_service_id)
);
CREATE INDEX business_output_product_idx ON public.business_output (product_service_id);

-- Edge direction is parent -> child. A collection is scoped to a relation.
CREATE TABLE public.ontology_collection (
  parent_id bigint NOT NULL REFERENCES public.ontology_node (node_id),
  edge_type_id smallint NOT NULL REFERENCES public.edge_type,
  other_node_id bigint NOT NULL UNIQUE REFERENCES public.ontology_node (node_id),
  PRIMARY KEY (parent_id, edge_type_id)
);

CREATE FUNCTION public.prepare_ontology_collection() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE parent_kind text; parent_other boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(7310042);
  SELECT node_kind, is_other INTO parent_kind, parent_other
    FROM public.ontology_node WHERE node_id = NEW.parent_id;
  IF parent_other THEN
    RAISE EXCEPTION 'Other buckets cannot create nested collections';
  END IF;
  IF NEW.other_node_id IS NOT NULL THEN
    RAISE EXCEPTION 'Other nodes are generated automatically';
  END IF;
  INSERT INTO public.ontology_node (slug, node_kind, is_other)
    VALUES ('other', CASE WHEN parent_kind = 'root' THEN 'topic' ELSE parent_kind END, true)
    RETURNING node_id INTO NEW.other_node_id;
  INSERT INTO public.node_name (node_id, name, source)
    VALUES (NEW.other_node_id, 'Other', 'human');
  IF parent_kind IN ('product', 'service') THEN
    INSERT INTO public.product_service (node_id, node_kind, is_category)
      VALUES (NEW.other_node_id, parent_kind, true);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ontology_collection_prepare BEFORE INSERT ON public.ontology_collection
  FOR EACH ROW EXECUTE FUNCTION public.prepare_ontology_collection();

CREATE FUNCTION public.link_collection_other() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.ontology_edge (source_id, target_id, edge_type_id)
    VALUES (NEW.parent_id, NEW.other_node_id, NEW.edge_type_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER ontology_collection_link AFTER INSERT ON public.ontology_collection
  FOR EACH ROW EXECUTE FUNCTION public.link_collection_other();

CREATE FUNCTION public.guard_ontology_edge() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE hierarchy boolean; source_other boolean;
BEGIN
  -- Serialize graph edits so concurrent transactions cannot introduce a cycle
  -- or create two Other nodes for the same collection.
  PERFORM pg_advisory_xact_lock(7310042);
  IF TG_OP IN ('DELETE', 'UPDATE') AND EXISTS (
    SELECT 1 FROM public.ontology_collection
    WHERE parent_id = OLD.source_id AND edge_type_id = OLD.edge_type_id
      AND other_node_id = OLD.target_id
  ) THEN
    RAISE EXCEPTION 'The mandatory Other edge cannot be changed or deleted';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  SELECT is_hierarchy INTO hierarchy FROM public.edge_type WHERE edge_type_id = NEW.edge_type_id;
  IF hierarchy AND EXISTS (
    WITH RECURSIVE descendants(id) AS (
      SELECT NEW.target_id
      UNION
      SELECT e.target_id FROM public.ontology_edge e
      JOIN descendants d ON e.source_id = d.id
      WHERE e.edge_type_id = NEW.edge_type_id
        AND (TG_OP <> 'UPDATE' OR e.edge_id <> NEW.edge_id)
    ) SELECT 1 FROM descendants WHERE id = NEW.source_id
  ) THEN RAISE EXCEPTION 'Hierarchy relation would contain a cycle'; END IF;
  SELECT is_other INTO source_other FROM public.ontology_node WHERE node_id = NEW.source_id;
  IF NOT source_other AND NOT EXISTS (
    SELECT 1 FROM public.ontology_collection
    WHERE parent_id = NEW.source_id AND edge_type_id = NEW.edge_type_id
  ) THEN
    INSERT INTO public.ontology_collection (parent_id, edge_type_id)
      VALUES (NEW.source_id, NEW.edge_type_id);
  END IF;
  -- An Other bucket belongs only to its own parent and relation.
  IF EXISTS (SELECT 1 FROM public.ontology_node WHERE node_id = NEW.target_id AND is_other)
    AND NOT EXISTS (SELECT 1 FROM public.ontology_collection
      WHERE parent_id = NEW.source_id AND edge_type_id = NEW.edge_type_id
        AND other_node_id = NEW.target_id) THEN
    RAISE EXCEPTION 'Other belongs to a different collection';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ontology_edge_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ontology_edge
  FOR EACH ROW EXECUTE FUNCTION public.guard_ontology_edge();

CREATE FUNCTION public.guard_collection_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Collection identity and its Other bucket are permanent';
END;
$$;
CREATE TRIGGER ontology_collection_identity BEFORE UPDATE OR DELETE ON public.ontology_collection
  FOR EACH ROW EXECUTE FUNCTION public.guard_collection_identity();

CREATE FUNCTION public.guard_graph_metadata() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_TABLE_NAME = 'edge_type' THEN
    IF NEW.is_hierarchy IS DISTINCT FROM OLD.is_hierarchy THEN
      RAISE EXCEPTION 'Create a new relation instead of changing hierarchy semantics';
    END IF;
  ELSE
    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'Use ontology_edge and relation-scoped collections instead of parent_id';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.is_other IS DISTINCT FROM OLD.is_other THEN
      RAISE EXCEPTION 'Other identity cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ontology_node_metadata BEFORE INSERT OR UPDATE ON public.ontology_node
  FOR EACH ROW EXECUTE FUNCTION public.guard_graph_metadata();
CREATE TRIGGER edge_type_metadata BEFORE UPDATE ON public.edge_type
  FOR EACH ROW EXECUTE FUNCTION public.guard_graph_metadata();

CREATE FUNCTION public.guard_other_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.locale = 'us_en'
    AND EXISTS (SELECT 1 FROM public.ontology_collection WHERE other_node_id = OLD.node_id) THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'The default Other label cannot be removed'; END IF;
    IF NEW.node_id <> OLD.node_id OR NEW.locale <> OLD.locale OR NEW.name <> 'Other' THEN
      RAISE EXCEPTION 'The default Other label must remain Other in us_en';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER node_name_other_guard BEFORE UPDATE OR DELETE ON public.node_name
  FOR EACH ROW EXECUTE FUNCTION public.guard_other_name();

INSERT INTO public.edge_type (code, name, is_hierarchy)
VALUES ('subtype', 'Has subtype', true), ('part', 'Has part', true),
       ('related', 'Related to', false);

DO $$
DECLARE root_id bigint; relation_id smallint; kind text;
BEGIN
  SELECT edge_type_id INTO relation_id FROM public.edge_type WHERE code = 'subtype';
  FOREACH kind IN ARRAY ARRAY['product', 'service'] LOOP
    INSERT INTO public.ontology_node (slug, node_kind)
      VALUES (kind || 's', kind) RETURNING node_id INTO root_id;
    INSERT INTO public.node_name (node_id, name, source)
      VALUES (root_id, CASE kind WHEN 'product' THEN 'Products' ELSE 'Services' END, 'human');
    INSERT INTO public.product_service (node_id, node_kind, is_category)
      VALUES (root_id, kind, true);
    INSERT INTO public.ontology_collection (parent_id, edge_type_id)
      VALUES (root_id, relation_id);
  END LOOP;
END;
$$;

CREATE VIEW public.business_catalog AS
SELECT b.business_id, n.slug, nn.name, b.legal_name,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('node_id', p.node_id, 'kind', p.node_kind,
    'name', pn.name, 'notes', i.notes) ORDER BY p.node_id)
    FROM public.business_input i JOIN public.product_service p ON p.node_id = i.product_service_id
    LEFT JOIN public.node_name pn ON pn.node_id = p.node_id AND pn.locale = 'us_en'
    WHERE i.business_id = b.business_id), '[]'::jsonb) AS inputs,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('node_id', p.node_id, 'kind', p.node_kind,
    'name', pn.name, 'notes', o.notes) ORDER BY p.node_id)
    FROM public.business_output o JOIN public.product_service p ON p.node_id = o.product_service_id
    LEFT JOIN public.node_name pn ON pn.node_id = p.node_id AND pn.locale = 'us_en'
    WHERE o.business_id = b.business_id), '[]'::jsonb) AS outputs,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('individual_id', i.individual_id,
    'name', i.display_name, 'role', r.role, 'is_primary', r.is_primary) ORDER BY i.display_name, i.individual_id)
    FROM public.business_representative r JOIN public.individual i USING (individual_id)
    WHERE r.business_id = b.business_id), '[]'::jsonb) AS representatives
FROM public.business b JOIN public.ontology_node n ON n.node_id = b.business_id
LEFT JOIN public.node_name nn ON nn.node_id = b.business_id AND nn.locale = 'us_en';
