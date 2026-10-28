-- Integration checks use real imported classes; all businesses/listings roll back.
BEGIN;
DO $$
DECLARE
  buyer bigint; seller bigint; br uuid; sr uuid; stranger uuid;
  exact_class bigint; broad_class bigint; sibling_class bigint; other_class bigint;
  need public.business_listing; offer public.business_listing; extra public.business_listing;
  result record; n integer;
BEGIN
  SELECT node_id INTO STRICT exact_class FROM ontology_node_source WHERE code='13030204';
  SELECT node_id INTO STRICT broad_class FROM ontology_node_source WHERE code='13030200';
  SELECT node_id INTO STRICT sibling_class FROM ontology_node_source WHERE code='13030205';
  SELECT c.other_node_id INTO STRICT other_class FROM ontology_collection c
    JOIN edge_type t USING(edge_type_id) WHERE c.parent_id=broad_class AND t.code='subtype';
  INSERT INTO ontology_node(slug,node_kind) VALUES ('test-buyer','organization') RETURNING node_id INTO buyer;
  INSERT INTO ontology_node(slug,node_kind) VALUES ('test-seller','organization') RETURNING node_id INTO seller;
  INSERT INTO business(business_id) VALUES (buyer),(seller);
  INSERT INTO individual(display_name) VALUES ('Buyer rep') RETURNING individual_id INTO br;
  INSERT INTO individual(display_name) VALUES ('Seller rep') RETURNING individual_id INTO sr;
  INSERT INTO individual(display_name) VALUES ('Unrelated person') RETURNING individual_id INTO stranger;
  INSERT INTO business_representative(business_id,individual_id) VALUES (buyer,br),(seller,sr);
  need := create_business_listing(buyer,br,'input','service',exact_class,'Need software development');
  offer := create_business_listing(seller,sr,'output','service',exact_class,'Offer software development');
  IF need.locale <> 'us_en' OR need.state <> 'draft' THEN RAISE EXCEPTION 'Incorrect listing defaults'; END IF;
  PERFORM set_listing_state(need.listing_id,br,'published');
  SELECT count(*) INTO n FROM match_businesses(buyer) WHERE seller_business_id=seller;
  IF n <> 0 THEN RAISE EXCEPTION 'Draft offer leaked into matches'; END IF;
  BEGIN
    PERFORM set_listing_state(offer.listing_id,stranger,'published');
    RAISE EXCEPTION 'Nonrepresentative published listing';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Actor does not represent this business' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_business_listing(buyer,stranger,'output','service',exact_class,'Invalid');
    RAISE EXCEPTION 'Nonrepresentative created listing';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'Actor does not represent this business' THEN RAISE; END IF;
  END;
  PERFORM set_listing_state(offer.listing_id,sr,'published');
  SELECT * INTO STRICT result FROM match_businesses(buyer) WHERE seller_business_id=seller;
  IF result.match_type <> 'same_class' OR result.score <> 100 OR result.seller_representative_id <> sr
    OR result.buyer_representative_id <> br THEN
    RAISE EXCEPTION 'Exact class match or representative is wrong';
  END IF;
  IF (SELECT jsonb_array_length(inputs) FROM published_business_catalog WHERE business_id=buyer) <> 1
    OR (SELECT jsonb_array_length(outputs) FROM published_business_catalog WHERE business_id=seller) <> 1 THEN
    RAISE EXCEPTION 'Published business catalog lost listings';
  END IF;
  SELECT count(*) INTO n FROM match_businesses(seller,'output') WHERE buyer_business_id=buyer;
  IF n <> 1 THEN RAISE EXCEPTION 'Reverse seller discovery failed'; END IF;
  UPDATE ontology_node SET status='archived' WHERE node_id=seller;
  IF EXISTS(SELECT 1 FROM match_businesses(buyer) WHERE seller_business_id=seller) THEN RAISE EXCEPTION 'Archived business matched'; END IF;
  UPDATE ontology_node SET status='published' WHERE node_id=seller;
  -- Known hard conflicts exclude candidates; missing information is visible.
  UPDATE business_listing SET attributes='{"language":"python"}',quantity=10,quantity_unit='hour',regions=ARRAY['FR'] WHERE listing_id=need.listing_id;
  SELECT * INTO STRICT result FROM match_businesses(buyer) WHERE seller_business_id=seller;
  IF result.assessment <> 'requirements_unknown' OR NOT result.unknown_requirements @> ARRAY['attribute:language','quantity','delivery_region'] THEN
    RAISE EXCEPTION 'Unknown requirements were hidden';
  END IF;
  UPDATE business_listing SET attributes='{"language":"java"}' WHERE listing_id=offer.listing_id;
  IF EXISTS(SELECT 1 FROM match_businesses(buyer) WHERE seller_business_id=seller) THEN RAISE EXCEPTION 'Conflicting attributes matched'; END IF;
  UPDATE business_listing SET attributes='{"language":"python"}',quantity=5,quantity_unit='hour',regions=ARRAY['FR'] WHERE listing_id=offer.listing_id;
  IF EXISTS(SELECT 1 FROM match_businesses(buyer) WHERE seller_business_id=seller) THEN RAISE EXCEPTION 'Insufficient quantity matched'; END IF;
  UPDATE business_listing SET quantity=20,regions=ARRAY['DE'] WHERE listing_id=offer.listing_id;
  IF EXISTS(SELECT 1 FROM match_businesses(buyer) WHERE seller_business_id=seller) THEN RAISE EXCEPTION 'Region conflict matched'; END IF;
  UPDATE business_listing SET regions=ARRAY['FR'],quantity_unit='day' WHERE listing_id=offer.listing_id;
  SELECT * INTO STRICT result FROM match_businesses(buyer) WHERE seller_business_id=seller;
  IF NOT result.unknown_requirements @> ARRAY['quantity_unit_conversion'] THEN RAISE EXCEPTION 'Units silently compared'; END IF;
  UPDATE business_listing SET available_until=current_date-1 WHERE listing_id=offer.listing_id;
  IF EXISTS(SELECT 1 FROM match_businesses(buyer) WHERE seller_business_id=seller) THEN RAISE EXCEPTION 'Expired listing matched'; END IF;
  UPDATE business_listing SET attributes='{}',quantity=NULL,quantity_unit=NULL,regions='{}' WHERE listing_id=need.listing_id;
  UPDATE business_listing SET attributes='{}',quantity=NULL,quantity_unit=NULL,regions='{}',available_until=NULL,class_node_id=broad_class WHERE listing_id=offer.listing_id;
  SELECT * INTO STRICT result FROM match_businesses(buyer) WHERE seller_business_id=seller;
  IF result.match_type <> 'broad_offer' OR result.assessment <> 'needs_clarification' THEN RAISE EXCEPTION 'Broad claim treated as specific'; END IF;
  UPDATE business_listing SET class_node_id=broad_class WHERE listing_id=need.listing_id;
  UPDATE business_listing SET class_node_id=exact_class WHERE listing_id=offer.listing_id;
  SELECT * INTO STRICT result FROM match_businesses(buyer) WHERE seller_business_id=seller;
  IF result.match_type <> 'specific_offer' THEN RAISE EXCEPTION 'Specific offer did not match broader need'; END IF;
  UPDATE business_listing SET class_node_id=sibling_class WHERE listing_id=need.listing_id;
  SELECT * INTO STRICT result FROM match_businesses(buyer) WHERE seller_business_id=seller;
  IF result.match_type <> 'nearby_alternative' OR result.taxonomy_distance <> 2 THEN RAISE EXCEPTION 'Sibling alternative failed'; END IF;
  IF EXISTS(SELECT 1 FROM match_businesses(buyer,'input',0) WHERE seller_business_id=seller) THEN RAISE EXCEPTION 'Distance bound ignored'; END IF;
  UPDATE business_listing SET class_node_id=other_class WHERE listing_id=need.listing_id;
  IF EXISTS(SELECT 1 FROM match_businesses(buyer) WHERE seller_business_id=seller) THEN RAISE EXCEPTION 'Other acted as a wildcard'; END IF;
  UPDATE business_listing SET class_node_id=other_class WHERE listing_id=offer.listing_id;
  SELECT * INTO STRICT result FROM match_businesses(buyer) WHERE seller_business_id=seller;
  IF result.match_type <> 'unclassified' THEN RAISE EXCEPTION 'Other match was overclaimed'; END IF;
  PERFORM set_listing_state(offer.listing_id,sr,'withdrawn');
  IF EXISTS(SELECT 1 FROM match_businesses(buyer) WHERE seller_business_id=seller) THEN RAISE EXCEPTION 'Withdrawn listing matched'; END IF;
  -- Same-business outputs are excluded.
  extra := create_business_listing(buyer,br,'output','service',other_class,'Own offer');
  PERFORM set_listing_state(extra.listing_id,br,'published');
  IF EXISTS(SELECT 1 FROM match_businesses(buyer) WHERE seller_business_id=buyer) THEN RAISE EXCEPTION 'Business matched itself'; END IF;
  IF (SELECT count(*) FROM ontology_node_source) <> 41647 OR (SELECT count(*) FROM ontology_node_alias) <> 54992
    OR (SELECT count(*) FROM catalog_property_synonym) <> 505 THEN RAISE EXCEPTION 'Wrong imported counts'; END IF;
  IF EXISTS(SELECT 1 FROM ontology_collection c LEFT JOIN ontology_edge e
    ON e.source_id=c.parent_id AND e.target_id=c.other_node_id AND e.edge_type_id=c.edge_type_id
    LEFT JOIN node_name nn ON nn.node_id=c.other_node_id AND nn.locale='us_en'
    WHERE e.edge_id IS NULL OR nn.name IS DISTINCT FROM 'Other') THEN RAISE EXCEPTION 'Missing Other bucket'; END IF;
  RAISE NOTICE 'Import, publishing authorization, lifecycle, exact/broad/sibling/Other matching, hard conflicts and unknown requirements passed';
END;
$$;
ROLLBACK;
