-- Hosted administrators are granted explicitly by a trusted database owner.
CREATE TABLE public.biz_admin (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.biz_admin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.biz_admin FROM PUBLIC;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON public.biz_admin FROM %I',r);
  END IF;
 END LOOP;
END $$;
