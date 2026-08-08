-- 027_expand_rls_to_owner_support.sql
-- Widen RLS policies that hardcode ['admin', 'sales'] to include ['owner', 'admin', 'sales', 'support'].
--
-- Wave 0 expanded customers.role CHECK to 6 values (owner|admin|sales|support|student|affiliate),
-- and Wave 2 Track E added user management + audit + seed 'owner' as the default role for the
-- first admin. But 18 pre-existing RLS policies still filter by only ['admin', 'sales']. Result:
-- anyone with role='owner' (like the seeded admin user) silently gets 0 rows on SELECT and
-- silently fails on INSERT/UPDATE/DELETE.
--
-- Symptom the user reported: "tạo sản phẩm bấm không có gì cả" — insert into products blocked
-- by admin_products RLS. Same for courses, leads, care_history, enrollments, KB tables etc.
--
-- Design: replace each affected policy with the widened role list. INSERT/UPDATE/DELETE gated
-- to 'owner|admin|sales|support' (support is fine for content ops, matches what most SaaS treat
-- as "team members"). Chat + KB were already OK for support in some places — normalise all.

DO $$
DECLARE
  rec RECORD;
  new_qual TEXT;
BEGIN
  FOR rec IN
    SELECT tablename, policyname, cmd, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        qual LIKE '%''admin''::text, ''sales''::text%'
        OR with_check LIKE '%''admin''::text, ''sales''::text%'
      )
  LOOP
    RAISE NOTICE 'Widening policy % on %.%', rec.policyname, 'public', rec.tablename;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', rec.policyname, rec.tablename);
    -- All these policies were of the same shape:
    --   EXISTS (SELECT 1 FROM customers WHERE id = auth.uid() AND role = ANY(ARRAY['admin','sales']))
    -- Rebuild with the wider list.
    EXECUTE format(
      $f$CREATE POLICY %I ON public.%I FOR %s
        USING (EXISTS (SELECT 1 FROM customers
                       WHERE customers.id = auth.uid()
                         AND customers.role = ANY(ARRAY['owner','admin','sales','support'])))$f$,
      rec.policyname, rec.tablename,
      CASE rec.cmd
        WHEN 'ALL' THEN 'ALL'
        WHEN 'SELECT' THEN 'SELECT'
        WHEN 'INSERT' THEN 'INSERT'
        WHEN 'UPDATE' THEN 'UPDATE'
        WHEN 'DELETE' THEN 'DELETE'
        ELSE 'ALL'
      END
    );
  END LOOP;
END $$;

-- Sanity check: no policy should still be limited to admin+sales after this runs.
DO $$
DECLARE
  leftover INT;
BEGIN
  SELECT count(*) INTO leftover
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      qual LIKE '%''admin''::text, ''sales''::text%'
      OR with_check LIKE '%''admin''::text, ''sales''::text%'
    );
  IF leftover > 0 THEN
    RAISE WARNING 'Still % policies with old admin|sales-only role list', leftover;
  ELSE
    RAISE NOTICE 'All admin|sales-only policies widened to owner|admin|sales|support.';
  END IF;
END $$;
