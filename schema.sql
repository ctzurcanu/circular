-- Executable schema for the local biz database (PostgreSQL 17).
-- Default application locale: us_en (English, United States).
-- Local user-ID table supports the Supabase auth.users foreign keys;
-- it does not implement Supabase authentication.
CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE public.locale (
  locale text NOT NULL,
  display_name text NOT NULL,
  dir text NOT NULL DEFAULT 'ltr'::text CHECK (dir = ANY (ARRAY['ltr'::text, 'rtl'::text])),
  is_active boolean NOT NULL DEFAULT true,
  is_source boolean NOT NULL DEFAULT false,
  fallback text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT locale_pkey PRIMARY KEY (locale),
  CONSTRAINT locale_fallback_fkey FOREIGN KEY (fallback) REFERENCES public.locale(locale)
);
CREATE TABLE public.ontology_node (
  node_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text),
  parent_id bigint,
  node_kind text NOT NULL DEFAULT 'topic'::text CHECK (node_kind = ANY (ARRAY['root'::text, 'topic'::text, 'product'::text, 'service'::text, 'organization'::text])),
  status text NOT NULL DEFAULT 'published'::text CHECK (status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])),
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  logo_url text,
  claimed_by uuid,
  website text,
  contact_email text,
  CONSTRAINT ontology_node_pkey PRIMARY KEY (node_id),
  CONSTRAINT ontology_node_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.ontology_node(node_id),
  CONSTRAINT ontology_node_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  CONSTRAINT ontology_node_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES auth.users(id)
);
CREATE TABLE public.edge_type (
  edge_type_id smallint GENERATED ALWAYS AS IDENTITY NOT NULL,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  is_hierarchy boolean NOT NULL DEFAULT false,
  CONSTRAINT edge_type_pkey PRIMARY KEY (edge_type_id)
);
CREATE TABLE public.ontology_edge (
  edge_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  source_id bigint NOT NULL,
  target_id bigint NOT NULL,
  edge_type_id smallint NOT NULL,
  weight real,
  distance real,
  position integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT ontology_edge_pkey PRIMARY KEY (edge_id),
  CONSTRAINT ontology_edge_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.ontology_node(node_id),
  CONSTRAINT ontology_edge_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.ontology_node(node_id),
  CONSTRAINT ontology_edge_edge_type_id_fkey FOREIGN KEY (edge_type_id) REFERENCES public.edge_type(edge_type_id)
);
CREATE TABLE public.node_name (
  node_id bigint NOT NULL,
  locale text NOT NULL DEFAULT 'us_en'::text,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  source text NOT NULL DEFAULT 'machine'::text CHECK (source = ANY (ARRAY['human'::text, 'machine'::text, 'imported'::text, 'eclass.eu-16.0'::text])),
  status text NOT NULL DEFAULT 'current'::text CHECK (status = ANY (ARRAY['current'::text, 'stale'::text, 'draft'::text])),
  translated_from text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT node_name_pkey PRIMARY KEY (node_id, locale),
  CONSTRAINT node_name_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.ontology_node(node_id),
  CONSTRAINT node_name_locale_fkey FOREIGN KEY (locale) REFERENCES public.locale(locale),
  CONSTRAINT node_name_translated_from_fkey FOREIGN KEY (translated_from) REFERENCES public.locale(locale)
);
CREATE TABLE public.tag_kind (
  kind text NOT NULL,
  is_exclusive boolean NOT NULL DEFAULT false,
  is_filterable boolean NOT NULL DEFAULT true,
  position integer,
  CONSTRAINT tag_kind_pkey PRIMARY KEY (kind)
);
CREATE TABLE public.tag (
  tag_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  kind text NOT NULL,
  code text NOT NULL,
  parent_id bigint,
  external_ns text,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT tag_pkey PRIMARY KEY (tag_id),
  CONSTRAINT tag_kind_fkey FOREIGN KEY (kind) REFERENCES public.tag_kind(kind),
  CONSTRAINT tag_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.tag(tag_id)
);
CREATE TABLE public.tag_name (
  tag_id bigint NOT NULL,
  locale text NOT NULL DEFAULT 'us_en'::text,
  name text NOT NULL,
  source text NOT NULL DEFAULT 'machine'::text CHECK (source = ANY (ARRAY['human'::text, 'machine'::text, 'imported'::text])),
  status text NOT NULL DEFAULT 'current'::text CHECK (status = ANY (ARRAY['current'::text, 'stale'::text, 'draft'::text])),
  CONSTRAINT tag_name_pkey PRIMARY KEY (tag_id, locale),
  CONSTRAINT tag_name_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tag(tag_id),
  CONSTRAINT tag_name_locale_fkey FOREIGN KEY (locale) REFERENCES public.locale(locale)
);
CREATE TABLE public.node_tag (
  node_id bigint NOT NULL,
  tag_id bigint NOT NULL,
  assigned_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT node_tag_pkey PRIMARY KEY (node_id, tag_id),
  CONSTRAINT node_tag_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.tag(tag_id),
  CONSTRAINT node_tag_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.ontology_node(node_id),
  CONSTRAINT node_tag_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id)
);
CREATE TABLE public.node_proposal (
  proposal_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  parent_id bigint,
  name_en text NOT NULL CHECK (length(btrim(name_en)) > 0),
  description_en text,
  proposed_tags bigint[] NOT NULL DEFAULT '{}'::bigint[],
  proposed_by uuid,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT node_proposal_pkey PRIMARY KEY (proposal_id),
  CONSTRAINT node_proposal_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.ontology_node(node_id),
  CONSTRAINT node_proposal_proposed_by_fkey FOREIGN KEY (proposed_by) REFERENCES auth.users(id)
);
CREATE TABLE public.translation_job (
  job_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  entity text NOT NULL CHECK (entity = ANY (ARRAY['node'::text, 'tag'::text])),
  entity_id bigint NOT NULL,
  locale text NOT NULL DEFAULT 'us_en'::text,
  state text NOT NULL DEFAULT 'queued'::text CHECK (state = ANY (ARRAY['queued'::text, 'running'::text, 'done'::text, 'failed'::text])),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT translation_job_pkey PRIMARY KEY (job_id),
  CONSTRAINT translation_job_locale_fkey FOREIGN KEY (locale) REFERENCES public.locale(locale)
);
CREATE TABLE public.org_invite (
  invite_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  org_id bigint NOT NULL,
  email text NOT NULL,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  invited_by uuid,
  accepted_at timestamp with time zone,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT org_invite_pkey PRIMARY KEY (invite_id),
  CONSTRAINT org_invite_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.ontology_node(node_id)
);
CREATE TABLE public.connection_request (
  request_id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  from_org_id bigint NOT NULL,
  to_org_id bigint NOT NULL,
  from_user_id uuid NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  responded_at timestamp with time zone,
  CONSTRAINT connection_request_pkey PRIMARY KEY (request_id),
  CONSTRAINT connection_request_from_org_id_fkey FOREIGN KEY (from_org_id) REFERENCES public.ontology_node(node_id),
  CONSTRAINT connection_request_to_org_id_fkey FOREIGN KEY (to_org_id) REFERENCES public.ontology_node(node_id)
);

INSERT INTO public.locale (locale, display_name, dir, is_active, is_source)
VALUES ('us_en', 'English (United States)', 'ltr', true, true);

-- psql resolves this path relative to this schema file.
\ir migrations/000_legacy_graph_compatibility.sql
\ir migrations/001_business_graph.sql
\ir migrations/002_catalog_and_listings.sql
\ir migrations/003_web_boundary.sql
\ir migrations/004_representative_chat.sql
\ir migrations/005_region_matching.sql
\ir migrations/006_taxonomy_admin.sql
\ir migrations/007_eclass_definition_source.sql
