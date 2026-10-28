CREATE TABLE public.biz_conversation (
  conversation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_listing_id uuid NOT NULL REFERENCES business_listing,
  offer_listing_id uuid NOT NULL REFERENCES business_listing,
  buyer_business_id bigint NOT NULL REFERENCES business,
  seller_business_id bigint NOT NULL REFERENCES business,
  buyer_representative_id uuid NOT NULL,
  seller_representative_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(buyer_business_id,buyer_representative_id) REFERENCES business_representative(business_id,individual_id),
  FOREIGN KEY(seller_business_id,seller_representative_id) REFERENCES business_representative(business_id,individual_id),
  UNIQUE(request_listing_id,offer_listing_id,buyer_representative_id,seller_representative_id)
);
CREATE TABLE public.biz_conversation_member (
  conversation_id uuid NOT NULL REFERENCES biz_conversation ON DELETE CASCADE,
  individual_id uuid NOT NULL REFERENCES individual,
  PRIMARY KEY(conversation_id,individual_id)
);
CREATE INDEX conversation_individual_idx ON biz_conversation_member(individual_id);
CREATE TABLE public.biz_message (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  content text NOT NULL CHECK(length(btrim(content)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(conversation_id,sender_id) REFERENCES biz_conversation_member(conversation_id,individual_id)
);
CREATE INDEX message_conversation_idx ON biz_message(conversation_id,created_at,message_id);
DO $$
DECLARE tab text; role_name text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['biz_conversation','biz_conversation_member','biz_message'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',tab);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',tab,role_name);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
