-- Run with psql -v ON_ERROR_STOP=1 -f tests/business_graph.sql.
-- All fixture rows are rolled back.
BEGIN;
DO $$
DECLARE
  org bigint; product bigint; child bigint; other_id bigint;
  subtype smallint; part smallint; related smallint;
  person uuid; result jsonb; total integer;
BEGIN
  SELECT edge_type_id INTO subtype FROM edge_type WHERE code = 'subtype';
  SELECT edge_type_id INTO part FROM edge_type WHERE code = 'part';
  SELECT edge_type_id INTO related FROM edge_type WHERE code = 'related';
  INSERT INTO ontology_node (slug, node_kind) VALUES ('test-business', 'organization') RETURNING node_id INTO org;
  INSERT INTO business (business_id, legal_name) VALUES (org, 'Test business');
  INSERT INTO node_name (node_id, name, source) VALUES (org, 'Test business', 'human');
  INSERT INTO individual (display_name) VALUES ('Test representative') RETURNING individual_id INTO person;
  INSERT INTO business_representative (business_id, individual_id, is_primary) VALUES (org, person, true);
  INSERT INTO ontology_node (slug, node_kind) VALUES ('test-product', 'product') RETURNING node_id INTO product;
  INSERT INTO ontology_node (slug, node_kind) VALUES ('test-child', 'product') RETURNING node_id INTO child;
  INSERT INTO product_service (node_id, node_kind, is_category) VALUES (product, 'product', true), (child, 'product', false);
  INSERT INTO node_name (node_id, name) VALUES (product, 'Test product'), (child, 'Test child');
  INSERT INTO business_input VALUES (org, product, 'Required');
  INSERT INTO business_output VALUES (org, child, 'Produced');
  SELECT to_jsonb(c) INTO result FROM business_catalog c WHERE business_id = org;
  IF jsonb_array_length(result->'inputs') <> 1 OR jsonb_array_length(result->'outputs') <> 1
    OR jsonb_array_length(result->'representatives') <> 1 THEN
    RAISE EXCEPTION 'Business catalog lost inputs, outputs, or representatives';
  END IF;
  INSERT INTO ontology_edge (source_id, target_id, edge_type_id) VALUES (product, child, subtype);
  SELECT other_node_id INTO STRICT other_id FROM ontology_collection WHERE parent_id = product AND edge_type_id = subtype;
  IF NOT EXISTS (SELECT 1 FROM node_name WHERE node_id = other_id AND locale = 'us_en' AND name = 'Other') THEN
    RAISE EXCEPTION 'Automatic Other label missing';
  END IF;
  INSERT INTO ontology_edge (source_id, target_id, edge_type_id) VALUES (product, child, part);
  IF (SELECT other_node_id FROM ontology_collection WHERE parent_id = product AND edge_type_id = part) = other_id THEN
    RAISE EXCEPTION 'Other buckets must differ by relation';
  END IF;
  -- An uncategorized leaf can live under Other without infinite Other nesting.
  INSERT INTO ontology_edge (source_id, target_id, edge_type_id) VALUES (other_id, child, subtype);
  IF EXISTS (SELECT 1 FROM ontology_collection WHERE parent_id = other_id) THEN
    RAISE EXCEPTION 'Other unexpectedly created a nested collection';
  END IF;
  -- Multiple parents are allowed.
  INSERT INTO ontology_edge (source_id, target_id, edge_type_id)
    SELECT node_id, child, subtype FROM ontology_node WHERE slug = 'products' AND NOT is_other;
  BEGIN
    INSERT INTO ontology_edge (source_id, target_id, edge_type_id) VALUES (child, product, subtype);
    RAISE EXCEPTION 'Cycle was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Hierarchy relation would contain a cycle' THEN RAISE; END IF;
  END;
  BEGIN
    DELETE FROM ontology_edge WHERE source_id = product AND target_id = other_id AND edge_type_id = subtype;
    RAISE EXCEPTION 'Other edge was deleted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'The mandatory Other edge cannot be changed or deleted' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO ontology_edge (source_id, target_id, edge_type_id) VALUES (child, other_id, part);
    RAISE EXCEPTION 'Foreign Other bucket was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Other belongs to a different collection' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE node_name SET name = 'Renamed' WHERE node_id = other_id AND locale = 'us_en';
    RAISE EXCEPTION 'Other was renamed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'The default Other label must remain Other in us_en' THEN RAISE; END IF;
  END;
  BEGIN
    INSERT INTO individual (display_name) VALUES ('Second representative') RETURNING individual_id INTO person;
    INSERT INTO business_representative (business_id, individual_id, is_primary) VALUES (org, person, true);
    RAISE EXCEPTION 'Two primary representatives were accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO ontology_edge (source_id, target_id, edge_type_id) VALUES (product, child, subtype);
    RAISE EXCEPTION 'Duplicate edge was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO business (business_id) VALUES (child);
    RAISE EXCEPTION 'Product was accepted as a business';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE edge_type SET is_hierarchy = true WHERE edge_type_id = related;
    RAISE EXCEPTION 'Relation semantics were changed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Create a new relation instead of changing hierarchy semantics' THEN RAISE; END IF;
  END;
  INSERT INTO ontology_edge (source_id, target_id, edge_type_id) VALUES (product, child, related), (child, product, related);
  SELECT count(*) INTO total FROM ontology_collection c WHERE NOT EXISTS (
    SELECT 1 FROM ontology_edge e WHERE e.source_id = c.parent_id
      AND e.target_id = c.other_node_id AND e.edge_type_id = c.edge_type_id);
  IF total <> 0 THEN RAISE EXCEPTION 'A collection is missing its Other edge'; END IF;
  RAISE NOTICE 'Business catalog, typed records, multiple parents, relation-scoped Other, cycle and integrity checks passed';
END;
$$;
ROLLBACK;
