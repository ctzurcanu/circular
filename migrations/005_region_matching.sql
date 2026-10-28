-- Region collections expand to countries for discovery. Empty regions remain unknown.
CREATE OR REPLACE FUNCTION public.expand_biz_regions(regions text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(array_agg(DISTINCT coalesce(g.country,upper(btrim(r)))), '{}'::text[])
  FROM unnest(regions) r LEFT JOIN (VALUES
('AFRICA','DZ'),
('AFRICA','AO'),
('AFRICA','BJ'),
('AFRICA','BW'),
('AFRICA','BF'),
('AFRICA','BI'),
('AFRICA','CV'),
('AFRICA','CM'),
('AFRICA','CF'),
('AFRICA','TD'),
('AFRICA','KM'),
('AFRICA','CG'),
('AFRICA','CD'),
('AFRICA','CI'),
('AFRICA','DJ'),
('AFRICA','EG'),
('AFRICA','GQ'),
('AFRICA','ER'),
('AFRICA','SZ'),
('AFRICA','ET'),
('AFRICA','GA'),
('AFRICA','GM'),
('AFRICA','GH'),
('AFRICA','GN'),
('AFRICA','GW'),
('AFRICA','KE'),
('AFRICA','LS'),
('AFRICA','LR'),
('AFRICA','LY'),
('AFRICA','MG'),
('AFRICA','MW'),
('AFRICA','ML'),
('AFRICA','MR'),
('AFRICA','MU'),
('AFRICA','YT'),
('AFRICA','MA'),
('AFRICA','MZ'),
('AFRICA','NA'),
('AFRICA','NE'),
('AFRICA','NG'),
('AFRICA','RE'),
('AFRICA','RW'),
('AFRICA','SH'),
('AFRICA','ST'),
('AFRICA','SN'),
('AFRICA','SC'),
('AFRICA','SL'),
('AFRICA','SO'),
('AFRICA','ZA'),
('AFRICA','SS'),
('AFRICA','SD'),
('AFRICA','TZ'),
('AFRICA','TG'),
('AFRICA','TN'),
('AFRICA','UG'),
('AFRICA','EH'),
('AFRICA','ZM'),
('AFRICA','ZW'),
('ASIA','AF'),
('ASIA','AM'),
('ASIA','AZ'),
('ASIA','BH'),
('ASIA','BD'),
('ASIA','BT'),
('ASIA','BN'),
('ASIA','KH'),
('ASIA','CN'),
('ASIA','CY'),
('ASIA','GE'),
('ASIA','HK'),
('ASIA','IN'),
('ASIA','ID'),
('ASIA','IR'),
('ASIA','IQ'),
('ASIA','IL'),
('ASIA','JP'),
('ASIA','JO'),
('ASIA','KZ'),
('ASIA','KW'),
('ASIA','KG'),
('ASIA','LA'),
('ASIA','LB'),
('ASIA','MO'),
('ASIA','MY'),
('ASIA','MV'),
('ASIA','MN'),
('ASIA','MM'),
('ASIA','NP'),
('ASIA','KP'),
('ASIA','OM'),
('ASIA','PK'),
('ASIA','PS'),
('ASIA','PH'),
('ASIA','QA'),
('ASIA','SA'),
('ASIA','SG'),
('ASIA','KR'),
('ASIA','LK'),
('ASIA','SY'),
('ASIA','TW'),
('ASIA','TJ'),
('ASIA','TH'),
('ASIA','TL'),
('ASIA','TR'),
('ASIA','TM'),
('ASIA','AE'),
('ASIA','UZ'),
('ASIA','VN'),
('ASIA','YE'),
('EUROPE','AL'),
('EUROPE','AD'),
('EUROPE','AT'),
('EUROPE','BY'),
('EUROPE','BE'),
('EUROPE','BA'),
('EUROPE','BG'),
('EUROPE','HR'),
('EUROPE','CZ'),
('EUROPE','DK'),
('EUROPE','EE'),
('EUROPE','FO'),
('EUROPE','FI'),
('EUROPE','FR'),
('EUROPE','DE'),
('EUROPE','GI'),
('EUROPE','GR'),
('EUROPE','GG'),
('EUROPE','VA'),
('EUROPE','HU'),
('EUROPE','IS'),
('EUROPE','IE'),
('EUROPE','IM'),
('EUROPE','IT'),
('EUROPE','JE'),
('EUROPE','XK'),
('EUROPE','LV'),
('EUROPE','LI'),
('EUROPE','LT'),
('EUROPE','LU'),
('EUROPE','MT'),
('EUROPE','MD'),
('EUROPE','MC'),
('EUROPE','ME'),
('EUROPE','NL'),
('EUROPE','MK'),
('EUROPE','NO'),
('EUROPE','PL'),
('EUROPE','PT'),
('EUROPE','RO'),
('EUROPE','RU'),
('EUROPE','SM'),
('EUROPE','RS'),
('EUROPE','SK'),
('EUROPE','SI'),
('EUROPE','ES'),
('EUROPE','SJ'),
('EUROPE','SE'),
('EUROPE','CH'),
('EUROPE','UA'),
('EUROPE','GB'),
('N_AMERICA','AI'),
('N_AMERICA','AG'),
('N_AMERICA','AW'),
('N_AMERICA','BS'),
('N_AMERICA','BB'),
('N_AMERICA','BZ'),
('N_AMERICA','BM'),
('N_AMERICA','BQ'),
('N_AMERICA','CA'),
('N_AMERICA','KY'),
('N_AMERICA','CR'),
('N_AMERICA','CU'),
('N_AMERICA','CW'),
('N_AMERICA','DM'),
('N_AMERICA','DO'),
('N_AMERICA','SV'),
('N_AMERICA','GL'),
('N_AMERICA','GD'),
('N_AMERICA','GP'),
('N_AMERICA','GT'),
('N_AMERICA','HT'),
('N_AMERICA','HN'),
('N_AMERICA','JM'),
('N_AMERICA','MQ'),
('N_AMERICA','MX'),
('N_AMERICA','MS'),
('N_AMERICA','NI'),
('N_AMERICA','PA'),
('N_AMERICA','PR'),
('N_AMERICA','BL'),
('N_AMERICA','KN'),
('N_AMERICA','LC'),
('N_AMERICA','MF'),
('N_AMERICA','PM'),
('N_AMERICA','VC'),
('N_AMERICA','SX'),
('N_AMERICA','TT'),
('N_AMERICA','TC'),
('N_AMERICA','US'),
('N_AMERICA','VG'),
('N_AMERICA','VI'),
('S_AMERICA','AR'),
('S_AMERICA','BO'),
('S_AMERICA','BR'),
('S_AMERICA','CL'),
('S_AMERICA','CO'),
('S_AMERICA','EC'),
('S_AMERICA','FK'),
('S_AMERICA','GF'),
('S_AMERICA','GY'),
('S_AMERICA','PY'),
('S_AMERICA','PE'),
('S_AMERICA','SR'),
('S_AMERICA','UY'),
('S_AMERICA','VE'),
('OCEANIA','AS'),
('OCEANIA','AU'),
('OCEANIA','CX'),
('OCEANIA','CC'),
('OCEANIA','CK'),
('OCEANIA','FJ'),
('OCEANIA','PF'),
('OCEANIA','GU'),
('OCEANIA','HM'),
('OCEANIA','KI'),
('OCEANIA','MH'),
('OCEANIA','FM'),
('OCEANIA','NR'),
('OCEANIA','NC'),
('OCEANIA','NZ'),
('OCEANIA','NU'),
('OCEANIA','NF'),
('OCEANIA','MP'),
('OCEANIA','PW'),
('OCEANIA','PG'),
('OCEANIA','PN'),
('OCEANIA','WS'),
('OCEANIA','SB'),
('OCEANIA','TK'),
('OCEANIA','TO'),
('OCEANIA','TV'),
('OCEANIA','UM'),
('OCEANIA','VU'),
('OCEANIA','WF'),
('ANTARCTICA','AQ'),
('ANTARCTICA','BV'),
('ANTARCTICA','GS'),
('ANTARCTICA','TF'),
('EU','AT'),
('EU','BE'),
('EU','BG'),
('EU','HR'),
('EU','CY'),
('EU','CZ'),
('EU','DK'),
('EU','EE'),
('EU','FI'),
('EU','FR'),
('EU','DE'),
('EU','GR'),
('EU','HU'),
('EU','IE'),
('EU','IT'),
('EU','LV'),
('EU','LT'),
('EU','LU'),
('EU','MT'),
('EU','NL'),
('EU','PL'),
('EU','PT'),
('EU','RO'),
('EU','SK'),
('EU','SI'),
('EU','ES'),
('EU','SE')
) AS g(region,country) ON g.region=upper(btrim(r));
$$;

CREATE OR REPLACE FUNCTION public.biz_regions_overlap(a text[], b text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT cardinality(a)=0 OR cardinality(b)=0 OR 'GLOBAL'=ANY(a) OR 'GLOBAL'=ANY(b)
   OR public.expand_biz_regions(a) && public.expand_biz_regions(b);
$$;

CREATE OR REPLACE FUNCTION public.match_businesses(p_business bigint, p_direction text DEFAULT 'input',
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
      AND public.biz_regions_overlap(i.regions, o.regions)
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

