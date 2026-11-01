CREATE TABLE public.catalog_release (
  release_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  version text NOT NULL,
  locale text NOT NULL DEFAULT 'us_en' REFERENCES public.locale,
  root_node_id bigint NOT NULL UNIQUE REFERENCES public.ontology_node,
  class_sha256 text NOT NULL,
  keyword_sha256 text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, version, locale)
);
CREATE TABLE public.ontology_node_source (
  release_id bigint NOT NULL REFERENCES public.catalog_release,
  irdi text NOT NULL,
  node_id bigint NOT NULL UNIQUE REFERENCES public.ontology_node,
  code text NOT NULL,
  identifier text NOT NULL,
  version_number text NOT NULL,
  revision_number text NOT NULL,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 4),
  is_unspecified boolean NOT NULL DEFAULT false,
  PRIMARY KEY (release_id, irdi),
  UNIQUE (release_id, code)
);
CREATE TABLE public.ontology_node_alias (
  release_id bigint NOT NULL REFERENCES public.catalog_release,
  irdi text NOT NULL,
  node_id bigint NOT NULL REFERENCES public.ontology_node,
  locale text NOT NULL DEFAULT 'us_en' REFERENCES public.locale,
  alias text NOT NULL CHECK (length(btrim(alias)) > 0),
  explanation text,
  PRIMARY KEY (release_id, irdi, node_id)
);
-- Property synonyms are preserved for a future property dictionary, not
-- incorrectly attached to classification nodes.
CREATE TABLE public.catalog_property_synonym (
  release_id bigint NOT NULL REFERENCES public.catalog_release,
  irdi text NOT NULL,
  property_irdi text NOT NULL,
  locale text NOT NULL DEFAULT 'us_en' REFERENCES public.locale,
  synonym text NOT NULL,
  explanation text,
  PRIMARY KEY (release_id, irdi, property_irdi)
);
CREATE INDEX node_alias_node_idx ON public.ontology_node_alias (node_id);
CREATE INDEX node_name_english_search_idx ON public.node_name USING gin (to_tsvector('english', name || ' ' || coalesce(description, '')));
CREATE INDEX node_alias_search_idx ON public.ontology_node_alias USING gin (to_tsvector('english', alias));

CREATE MATERIALIZED VIEW public.catalog_ancestor AS
WITH RECURSIVE paths(ancestor_id, descendant_id, distance) AS (
  SELECT node_id, node_id, 0 FROM public.ontology_node
  UNION ALL
  SELECT p.ancestor_id, e.target_id, p.distance + 1
  FROM paths p JOIN public.ontology_edge e ON e.source_id = p.descendant_id
  JOIN public.edge_type t USING (edge_type_id) WHERE t.code = 'subtype'
)
SELECT ancestor_id, descendant_id, min(distance)::integer AS distance
FROM paths GROUP BY ancestor_id, descendant_id WITH NO DATA;
CREATE UNIQUE INDEX catalog_ancestor_pk ON public.catalog_ancestor (ancestor_id, descendant_id);
CREATE INDEX catalog_ancestor_descendant_idx ON public.catalog_ancestor (descendant_id, distance, ancestor_id);
CREATE TABLE public.catalog_graph_state (singleton boolean PRIMARY KEY CHECK (singleton), dirty boolean NOT NULL);
INSERT INTO public.catalog_graph_state VALUES (true, true);
-- Acquire the graph lock before any tuple/cache locks, including node-only edits.
-- This keeps import, ordinary graph editing, and cache refresh lock order equal.
CREATE FUNCTION public.lock_catalog_graph() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(7310042);
  RETURN NULL;
END;
$$;
CREATE TRIGGER catalog_node_lock BEFORE INSERT OR UPDATE OR DELETE ON public.ontology_node
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_catalog_graph();
CREATE TRIGGER catalog_edge_lock BEFORE INSERT OR UPDATE OR DELETE ON public.ontology_edge
  FOR EACH STATEMENT EXECUTE FUNCTION public.lock_catalog_graph();
CREATE FUNCTION public.mark_catalog_dirty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.catalog_graph_state SET dirty = true WHERE singleton AND NOT dirty;
  RETURN NULL;
END;
$$;
CREATE TRIGGER catalog_edge_dirty AFTER INSERT OR UPDATE OR DELETE ON public.ontology_edge
  FOR EACH STATEMENT EXECUTE FUNCTION public.mark_catalog_dirty();
CREATE TRIGGER catalog_node_dirty AFTER INSERT OR UPDATE OR DELETE ON public.ontology_node
  FOR EACH STATEMENT EXECUTE FUNCTION public.mark_catalog_dirty();
CREATE FUNCTION public.refresh_catalog_ancestor() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(7310042);
  IF (SELECT dirty FROM public.catalog_graph_state WHERE singleton) THEN
    REFRESH MATERIALIZED VIEW public.catalog_ancestor;
    UPDATE public.catalog_graph_state SET dirty = false WHERE singleton;
  END IF;
END;
$$;

CREATE FUNCTION public.search_catalog(p_query text, p_limit integer DEFAULT 20, p_locale text DEFAULT 'us_en')
RETURNS TABLE(node_id bigint, code text, name text, description text, level smallint, is_other boolean,
  collection_parent_id bigint, parent_code text, parent_name text)
LANGUAGE sql STABLE AS $$
  SELECT n.node_id, s.code, nn.name, nn.description, s.level, n.is_other,
    bucket.parent_id, owner.code, parent_label.name
  FROM public.ontology_node n JOIN public.node_name nn USING (node_id)
  LEFT JOIN public.ontology_node_source s USING (node_id)
  LEFT JOIN public.ontology_collection bucket ON bucket.other_node_id = n.node_id
  LEFT JOIN public.ontology_node_source owner ON owner.node_id = bucket.parent_id
  LEFT JOIN public.node_name parent_label ON parent_label.node_id = bucket.parent_id AND parent_label.locale = p_locale
  WHERE nn.locale = p_locale AND n.node_kind IN ('topic', 'root', 'product', 'service') AND n.status = 'published'
    AND (s.node_id IS NOT NULL OR n.is_other)
    AND (s.code = btrim(p_query)
      OR to_tsvector('english', nn.name || ' ' || coalesce(nn.description, '')) @@ plainto_tsquery('english', p_query)
      OR EXISTS (SELECT 1 FROM public.ontology_node_alias a WHERE a.node_id = n.node_id AND a.locale = p_locale
        AND to_tsvector('english', a.alias) @@ plainto_tsquery('english', p_query)))
  ORDER BY (s.code = btrim(p_query)) DESC NULLS LAST,
    ts_rank(to_tsvector('english', nn.name), plainto_tsquery('english', p_query)) DESC,
    s.level DESC NULLS LAST, n.node_id
  LIMIT greatest(1, least(p_limit, 100));
$$;

CREATE TABLE public.business_listing (
  listing_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id bigint NOT NULL REFERENCES public.business,
  direction text NOT NULL CHECK (direction IN ('input', 'output')),
  kind text NOT NULL CHECK (kind IN ('product', 'service')),
  class_node_id bigint NOT NULL REFERENCES public.ontology_node,
  locale text NOT NULL DEFAULT 'us_en' REFERENCES public.locale,
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'published', 'withdrawn')),
  contact_individual_id uuid NOT NULL,
  quantity numeric CHECK (quantity > 0 AND quantity NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
  quantity_unit text,
  regions text[] NOT NULL DEFAULT '{}',
  available_from date,
  available_until date,
  attributes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(attributes) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  FOREIGN KEY (business_id, contact_individual_id) REFERENCES public.business_representative (business_id, individual_id),
  CHECK ((quantity IS NULL) = (quantity_unit IS NULL)),
  CHECK (quantity_unit IS NULL OR length(btrim(quantity_unit)) > 0),
  CHECK (available_until IS NULL OR available_from IS NULL OR available_until >= available_from),
  CHECK (state <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX listing_discovery_idx ON public.business_listing (direction, kind, class_node_id) WHERE state = 'published';
CREATE INDEX listing_business_idx ON public.business_listing (business_id, direction, state);

CREATE FUNCTION public.guard_listing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ontology_node n WHERE n.node_id = NEW.class_node_id
    AND n.node_kind IN ('topic', 'product', 'service') AND n.status = 'published') THEN
    RAISE EXCEPTION 'Listing classification must be an active category';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ontology_node n WHERE n.node_id = NEW.class_node_id
    AND n.node_kind IN ('product', 'service') AND n.node_kind <> NEW.kind) THEN
    RAISE EXCEPTION 'Listing kind does not match its classification';
  END IF;
  NEW.updated_at := now();
  NEW.regions := ARRAY(SELECT DISTINCT upper(btrim(r)) FROM unnest(NEW.regions) r WHERE length(btrim(r)) > 0 ORDER BY 1);
  NEW.quantity_unit := nullif(lower(btrim(NEW.quantity_unit)), '');
  IF NEW.state = 'published' THEN NEW.published_at := coalesce(NEW.published_at, now()); END IF;
  IF TG_OP = 'UPDATE' AND NEW.business_id <> OLD.business_id THEN
    RAISE EXCEPTION 'A listing cannot change business ownership';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER listing_guard BEFORE INSERT OR UPDATE ON public.business_listing
  FOR EACH ROW EXECUTE FUNCTION public.guard_listing();

CREATE FUNCTION public.create_business_listing(p_business bigint, p_actor uuid, p_direction text,
  p_kind text, p_class bigint, p_title text, p_description text DEFAULT NULL,
  p_quantity numeric DEFAULT NULL, p_unit text DEFAULT NULL, p_regions text[] DEFAULT '{}',
  p_from date DEFAULT NULL, p_until date DEFAULT NULL, p_attributes jsonb DEFAULT '{}')
RETURNS public.business_listing LANGUAGE plpgsql AS $$
DECLARE result public.business_listing;
BEGIN
  PERFORM 1 FROM public.business_representative
    WHERE business_id=p_business AND individual_id=p_actor FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Actor does not represent this business'; END IF;
  INSERT INTO public.business_listing(business_id,contact_individual_id,direction,kind,class_node_id,
    title,description,quantity,quantity_unit,regions,available_from,available_until,attributes)
    VALUES (p_business,p_actor,p_direction,p_kind,p_class,p_title,p_description,p_quantity,p_unit,p_regions,
      p_from,p_until,p_attributes) RETURNING * INTO result;
  RETURN result;
END;
$$;

-- These are trusted local/backend operations. The actor parameter is checked
-- against membership; an HTTP backend must derive it from authenticated identity.
CREATE FUNCTION public.set_listing_state(p_listing uuid, p_actor uuid, p_state text)
RETURNS public.business_listing LANGUAGE plpgsql AS $$
DECLARE result public.business_listing;
BEGIN
  IF p_state NOT IN ('draft', 'published', 'withdrawn') THEN RAISE EXCEPTION 'Invalid listing state'; END IF;
  SELECT l.* INTO result FROM public.business_listing l WHERE listing_id = p_listing FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Listing not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_representative r
    WHERE r.business_id = result.business_id AND r.individual_id = p_actor) THEN
    RAISE EXCEPTION 'Actor does not represent this business';
  END IF;
  UPDATE public.business_listing SET state = p_state WHERE listing_id = p_listing RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION public.match_businesses(p_business bigint, p_direction text DEFAULT 'input',
  p_max_distance integer DEFAULT 2, p_limit integer DEFAULT 50)
RETURNS TABLE(request_listing_id uuid, offer_listing_id uuid, buyer_business_id bigint,
  seller_business_id bigint, buyer_title text, seller_title text, match_type text,
  taxonomy_distance integer, score integer, assessment text, unknown_requirements text[],
  seller_representative_id uuid, seller_representative_name text,
  buyer_representative_id uuid, buyer_representative_name text)
LANGUAGE plpgsql AS $$
BEGIN
  IF p_direction NOT IN ('input','output') THEN RAISE EXCEPTION 'Invalid discovery direction'; END IF;
  IF p_max_distance < 0 OR p_max_distance > 6 THEN RAISE EXCEPTION 'Distance must be between 0 and 6'; END IF;
  PERFORM public.refresh_catalog_ancestor();
  RETURN QUERY
  WITH pairs AS (
    SELECT i AS need, o AS offer, i.class_node_id AS ic, o.class_node_id AS oc,
      ni.is_other OR no.is_other OR coalesce(si.is_unspecified, false) OR coalesce(so.is_unspecified, false) AS unspecified,
      forward.distance AS fd, backward.distance AS bd,
      sibling.distance AS sd
    FROM public.business_listing i JOIN public.business_listing o
      ON i.direction = 'input' AND o.direction = 'output' AND i.kind = o.kind AND i.business_id <> o.business_id
    JOIN public.ontology_node ni ON ni.node_id = i.class_node_id AND ni.status = 'published'
    JOIN public.ontology_node no ON no.node_id = o.class_node_id AND no.status = 'published'
    JOIN public.ontology_node buyer_node ON buyer_node.node_id = i.business_id AND buyer_node.status = 'published'
    JOIN public.ontology_node seller_node ON seller_node.node_id = o.business_id AND seller_node.status = 'published'
    LEFT JOIN public.ontology_node_source si ON si.node_id = i.class_node_id
    LEFT JOIN public.ontology_node_source so ON so.node_id = o.class_node_id
    LEFT JOIN public.catalog_ancestor forward ON forward.ancestor_id = i.class_node_id AND forward.descendant_id = o.class_node_id
    LEFT JOIN public.catalog_ancestor backward ON backward.ancestor_id = o.class_node_id AND backward.descendant_id = i.class_node_id
    LEFT JOIN LATERAL (
      SELECT min(a.distance + b.distance)::integer AS distance
      FROM public.catalog_ancestor a JOIN public.catalog_ancestor b USING (ancestor_id)
      JOIN public.ontology_node_source common ON common.node_id = a.ancestor_id AND common.level >= 2
      WHERE a.descendant_id = i.class_node_id AND b.descendant_id = o.class_node_id
        AND a.distance > 0 AND b.distance > 0
    ) sibling ON true
    WHERE i.state = 'published' AND o.state = 'published'
      AND ((p_direction = 'input' AND i.business_id = p_business) OR (p_direction = 'output' AND o.business_id = p_business))
      AND (i.available_until IS NULL OR i.available_until >= current_date)
      AND (o.available_until IS NULL OR o.available_until >= current_date)
      AND (i.available_until IS NULL OR o.available_from IS NULL OR o.available_from <= i.available_until)
      AND (o.available_until IS NULL OR i.available_from IS NULL OR i.available_from <= o.available_until)
      AND (cardinality(i.regions) = 0 OR cardinality(o.regions) = 0 OR i.regions && o.regions)
      AND (i.quantity IS NULL OR o.quantity IS NULL OR i.quantity_unit <> o.quantity_unit OR o.quantity >= i.quantity)
      AND NOT EXISTS (SELECT 1 FROM jsonb_each(i.attributes) req
        WHERE o.attributes ? req.key AND o.attributes->req.key <> req.value)
  ), candidates AS (
    SELECT p.*, coalesce(fd, bd, sd) AS dist,
      CASE WHEN unspecified THEN 'unclassified'
        WHEN ic = oc THEN 'same_class' WHEN fd IS NOT NULL THEN 'specific_offer'
        WHEN bd IS NOT NULL THEN 'broad_offer' ELSE 'nearby_alternative' END AS reason,
      ARRAY(SELECT 'attribute:' || key FROM jsonb_each((need).attributes) WHERE NOT (offer).attributes ? key)
      || CASE WHEN (need).quantity IS NOT NULL AND (offer).quantity IS NULL THEN ARRAY['quantity'] ELSE ARRAY[]::text[] END
      || CASE WHEN (need).quantity IS NOT NULL AND (offer).quantity IS NOT NULL AND (need).quantity_unit <> (offer).quantity_unit THEN ARRAY['quantity_unit_conversion'] ELSE ARRAY[]::text[] END
      || CASE WHEN cardinality((need).regions) > 0 AND cardinality((offer).regions) = 0 THEN ARRAY['delivery_region'] ELSE ARRAY[]::text[] END
      || CASE WHEN ((need).available_from IS NOT NULL OR (need).available_until IS NOT NULL)
           AND ((offer).available_from IS NULL OR (offer).available_until IS NULL) THEN ARRAY['availability'] ELSE ARRAY[]::text[] END AS unknowns
    FROM pairs p WHERE ic = oc OR (NOT unspecified AND least(fd, bd, sd) <= p_max_distance)
  )
  SELECT (need).listing_id, (offer).listing_id, (need).business_id, (offer).business_id,
    (need).title, (offer).title, reason, dist,
    (CASE reason WHEN 'same_class' THEN 100 WHEN 'specific_offer' THEN 90 - dist*5
      WHEN 'broad_offer' THEN 60 - dist*5 WHEN 'unclassified' THEN 20 ELSE 50 - dist*5 END
      - least(cardinality(unknowns)*5, 20))::integer,
    CASE WHEN reason IN ('unclassified','broad_offer','nearby_alternative') THEN 'needs_clarification'
      WHEN cardinality(unknowns) > 0 THEN 'requirements_unknown' ELSE 'category_match' END,
    unknowns, rep.individual_id, rep.display_name, buyer_rep.individual_id, buyer_rep.display_name
  FROM candidates JOIN public.individual rep ON rep.individual_id = (offer).contact_individual_id
  JOIN public.individual buyer_rep ON buyer_rep.individual_id = (need).contact_individual_id
  ORDER BY 9 DESC, (offer).business_id, (need).listing_id, (offer).listing_id
  LIMIT greatest(1, least(p_limit, 500));
END;
$$;

CREATE VIEW public.published_business_catalog AS
SELECT b.business_id, n.slug, nn.name, b.legal_name,
  coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at,l.listing_id)
    FROM public.business_listing l JOIN public.ontology_node category ON category.node_id=l.class_node_id
    WHERE l.business_id=b.business_id AND l.direction='input' AND l.state='published'
      AND category.status='published' AND (l.available_until IS NULL OR l.available_until >= current_date)), '[]'::jsonb) AS inputs,
  coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.created_at,l.listing_id)
    FROM public.business_listing l JOIN public.ontology_node category ON category.node_id=l.class_node_id
    WHERE l.business_id=b.business_id AND l.direction='output' AND l.state='published'
      AND category.status='published' AND (l.available_until IS NULL OR l.available_until >= current_date)), '[]'::jsonb) AS outputs,
  coalesce((SELECT jsonb_agg(jsonb_build_object('individual_id',i.individual_id,'name',i.display_name,'role',r.role)
      ORDER BY i.display_name,i.individual_id)
    FROM public.business_representative r JOIN public.individual i USING(individual_id)
    WHERE r.business_id=b.business_id), '[]'::jsonb) AS representatives
FROM public.business b JOIN public.ontology_node n ON n.node_id=b.business_id AND n.status='published'
LEFT JOIN public.node_name nn ON nn.node_id=b.business_id AND nn.locale='us_en';
