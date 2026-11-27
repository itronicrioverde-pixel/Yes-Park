-- Recovered migration history, no production rows or credentials.
-- Apply only to an empty Supabase environment.
-- Migration 20261023190759 yespark_mvp_catalogo_admin_avaliacoes_rls

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_yespark_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT EXISTS (
   SELECT 1 FROM public.admins a
   WHERE a.user_id = (SELECT auth.uid()) AND a.active
 )
$$;
REVOKE ALL ON FUNCTION public.is_yespark_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_yespark_admin() TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('empresa','servico')),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 75),
  category text NOT NULL,
  description text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 400),
  phone text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_listings_kind_active ON public.listings(kind, active);

CREATE TABLE IF NOT EXISTS public.ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 85),
  description text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 450),
  period text NOT NULL DEFAULT 'Especial',
  image_url text NOT NULL DEFAULT '',
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ads_period_valid CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_ads_public ON public.ads(active,starts_at,ends_at);

CREATE TABLE IF NOT EXISTS public.banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 100),
  subtitle text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  target_type text NOT NULL DEFAULT 'nenhuma'
    CHECK(target_type IN ('nenhuma','servicos','empresas','propagandas','empresa')),
  target_id uuid REFERENCES public.listings(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 50),
  comment text NOT NULL CHECK (char_length(comment) BETWEEN 10 AND 450),
  stars integer NOT NULL CHECK(stars BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','hidden')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_public ON public.reviews(listing_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS public.review_throttles (
  review_id uuid PRIMARY KEY REFERENCES public.reviews(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_limit ON public.review_throttles(fingerprint,created_at DESC);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_throttles ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon,authenticated;
GRANT SELECT ON public.listings,public.ads,public.banners,public.reviews TO anon,authenticated;
GRANT SELECT ON public.admins TO authenticated;
GRANT INSERT,UPDATE,DELETE ON public.listings,public.ads,public.banners TO authenticated;
GRANT UPDATE,DELETE ON public.reviews TO authenticated;
REVOKE ALL ON public.review_throttles FROM anon,authenticated;

CREATE POLICY yespark_admin_self_read ON public.admins
 FOR SELECT TO authenticated USING(user_id = (SELECT auth.uid()));

CREATE POLICY yespark_listings_read ON public.listings
 FOR SELECT TO anon,authenticated
 USING(active OR (SELECT public.is_yespark_admin()));
CREATE POLICY yespark_listings_insert ON public.listings
 FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_yespark_admin()));
CREATE POLICY yespark_listings_update ON public.listings
 FOR UPDATE TO authenticated USING((SELECT public.is_yespark_admin()))
 WITH CHECK ((SELECT public.is_yespark_admin()));
CREATE POLICY yespark_listings_delete ON public.listings
 FOR DELETE TO authenticated USING((SELECT public.is_yespark_admin()));

CREATE POLICY yespark_ads_read ON public.ads
 FOR SELECT TO anon,authenticated
 USING (
   (active AND (starts_at IS NULL OR starts_at <= now()) AND
    (ends_at IS NULL OR ends_at >= now()) AND
    EXISTS (SELECT 1 FROM public.listings l WHERE l.id=listing_id AND l.active))
   OR (SELECT public.is_yespark_admin())
 );
CREATE POLICY yespark_ads_insert ON public.ads
 FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_yespark_admin()));
CREATE POLICY yespark_ads_update ON public.ads
 FOR UPDATE TO authenticated USING((SELECT public.is_yespark_admin()))
 WITH CHECK ((SELECT public.is_yespark_admin()));
CREATE POLICY yespark_ads_delete ON public.ads
 FOR DELETE TO authenticated USING((SELECT public.is_yespark_admin()));

CREATE POLICY yespark_banners_read ON public.banners
 FOR SELECT TO anon,authenticated USING(active OR (SELECT public.is_yespark_admin()));
CREATE POLICY yespark_banners_insert ON public.banners
 FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_yespark_admin()));
CREATE POLICY yespark_banners_update ON public.banners
 FOR UPDATE TO authenticated USING((SELECT public.is_yespark_admin()))
 WITH CHECK ((SELECT public.is_yespark_admin()));
CREATE POLICY yespark_banners_delete ON public.banners
 FOR DELETE TO authenticated USING((SELECT public.is_yespark_admin()));

CREATE POLICY yespark_reviews_read ON public.reviews
 FOR SELECT TO anon,authenticated
 USING(status='approved' OR (SELECT public.is_yespark_admin()));
CREATE POLICY yespark_reviews_update ON public.reviews
 FOR UPDATE TO authenticated USING((SELECT public.is_yespark_admin()))
 WITH CHECK ((SELECT public.is_yespark_admin()));
CREATE POLICY yespark_reviews_delete ON public.reviews
 FOR DELETE TO authenticated USING((SELECT public.is_yespark_admin()));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('yespark-media','yespark-media',true,2097152,ARRAY['image/webp','image/png','image/jpeg'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY yespark_admin_read_media ON storage.objects
 FOR SELECT TO authenticated
 USING(bucket_id='yespark-media' AND (SELECT public.is_yespark_admin()));
CREATE POLICY yespark_admin_upload ON storage.objects
 FOR INSERT TO authenticated
 WITH CHECK(bucket_id='yespark-media' AND (SELECT public.is_yespark_admin()));
CREATE POLICY yespark_admin_update_files ON storage.objects
 FOR UPDATE TO authenticated
 USING(bucket_id='yespark-media' AND (SELECT public.is_yespark_admin()))
 WITH CHECK(bucket_id='yespark-media' AND (SELECT public.is_yespark_admin()));
CREATE POLICY yespark_admin_delete_files ON storage.objects
 FOR DELETE TO authenticated
 USING(bucket_id='yespark-media' AND (SELECT public.is_yespark_admin()));

CREATE OR REPLACE FUNCTION public.submit_yespark_review(
  p_listing_id uuid,p_display_name text,p_comment text,p_stars integer,p_fingerprint text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  IF length(coalesce(p_fingerprint,'')) < 32 THEN
    RAISE EXCEPTION 'Origem inválida';
  END IF;
  IF length(trim(coalesce(p_display_name,''))) NOT BETWEEN 2 AND 50
     OR length(trim(coalesce(p_comment,''))) NOT BETWEEN 10 AND 450
     OR p_stars NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'Dados da avaliação inválidos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.listings WHERE id=p_listing_id AND active) THEN
    RAISE EXCEPTION 'Cadastro não disponível';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(p_fingerprint));
  IF (SELECT count(*) FROM public.review_throttles
      WHERE fingerprint=p_fingerprint AND created_at > now() - interval '1 hour') >= 3
  THEN
    RAISE EXCEPTION 'Limite de avaliações temporariamente atingido';
  END IF;
  INSERT INTO public.reviews(listing_id,display_name,comment,stars,status)
  VALUES(p_listing_id,trim(p_display_name),trim(p_comment),p_stars,'pending')
  RETURNING id INTO v_id;
  INSERT INTO public.review_throttles(review_id,fingerprint) VALUES(v_id,p_fingerprint);
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_yespark_review(uuid,text,text,integer,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_yespark_review(uuid,text,text,integer,text)
 TO service_role;


-- Migration 20261023190937 yespark_harden_admin_check_invoker
GRANT SELECT ON public.admins TO anon; ALTER FUNCTION public.is_yespark_admin() SECURITY INVOKER;

-- Migration 20261023191032 yespark_restrict_privileges
REVOKE ALL ON TABLE public.admins FROM anon,authenticated;
GRANT SELECT ON TABLE public.admins TO authenticated;
REVOKE ALL ON TABLE public.review_throttles FROM anon,authenticated;
REVOKE ALL ON FUNCTION public.submit_yespark_review(uuid,text,text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_yespark_review(uuid,text,text,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.is_yespark_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_yespark_admin() TO anon,authenticated;

-- Migration 20261023191259 yespark_private_admin_rls_helper

CREATE SCHEMA IF NOT EXISTS yespark_private;
REVOKE ALL ON SCHEMA yespark_private FROM PUBLIC;
GRANT USAGE ON SCHEMA yespark_private TO anon, authenticated;
CREATE OR REPLACE FUNCTION yespark_private.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS
 (SELECT 1 FROM public.admins a WHERE a.user_id=(SELECT auth.uid()) AND a.active)
$$;
REVOKE ALL ON FUNCTION yespark_private.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yespark_private.is_admin() TO anon, authenticated;
ALTER POLICY yespark_listings_read ON public.listings
 USING(active OR (SELECT yespark_private.is_admin()));
ALTER POLICY yespark_listings_insert ON public.listings
 WITH CHECK ((SELECT yespark_private.is_admin()));
ALTER POLICY yespark_listings_update ON public.listings
 USING ((SELECT yespark_private.is_admin()))
 WITH CHECK ((SELECT yespark_private.is_admin()));
ALTER POLICY yespark_listings_delete ON public.listings
 USING ((SELECT yespark_private.is_admin()));
ALTER POLICY yespark_ads_read ON public.ads
 USING((active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at>=now())
  AND EXISTS(SELECT 1 FROM public.listings l WHERE l.id=listing_id AND l.active))
 OR (SELECT yespark_private.is_admin()));
ALTER POLICY yespark_ads_insert ON public.ads WITH CHECK ((SELECT yespark_private.is_admin()));
ALTER POLICY yespark_ads_update ON public.ads
 USING ((SELECT yespark_private.is_admin()))
 WITH CHECK ((SELECT yespark_private.is_admin()));
ALTER POLICY yespark_ads_delete ON public.ads USING ((SELECT yespark_private.is_admin()));
ALTER POLICY yespark_banners_read ON public.banners
 USING(active OR (SELECT yespark_private.is_admin()));
ALTER POLICY yespark_banners_insert ON public.banners WITH CHECK ((SELECT yespark_private.is_admin()));
ALTER POLICY yespark_banners_update ON public.banners
 USING ((SELECT yespark_private.is_admin())) WITH CHECK ((SELECT yespark_private.is_admin()));
ALTER POLICY yespark_banners_delete ON public.banners USING ((SELECT yespark_private.is_admin()));
ALTER POLICY yespark_reviews_read ON public.reviews
 USING(status='approved' OR (SELECT yespark_private.is_admin()));
ALTER POLICY yespark_reviews_update ON public.reviews
 USING ((SELECT yespark_private.is_admin())) WITH CHECK ((SELECT yespark_private.is_admin()));
ALTER POLICY yespark_reviews_delete ON public.reviews
 USING ((SELECT yespark_private.is_admin()));
ALTER POLICY yespark_admin_read_media ON storage.objects
 USING(bucket_id='yespark-media' AND (SELECT yespark_private.is_admin()));
ALTER POLICY yespark_admin_upload ON storage.objects
 WITH CHECK(bucket_id='yespark-media' AND (SELECT yespark_private.is_admin()));
ALTER POLICY yespark_admin_update_files ON storage.objects
 USING(bucket_id='yespark-media' AND (SELECT yespark_private.is_admin()))
 WITH CHECK(bucket_id='yespark-media' AND (SELECT yespark_private.is_admin()));
ALTER POLICY yespark_admin_delete_files ON storage.objects
 USING(bucket_id='yespark-media' AND (SELECT yespark_private.is_admin()));
DROP FUNCTION public.is_yespark_admin();


-- Migration 20261023200642 yespark_identificacao_de_conteudo_demonstrativo
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS sample boolean NOT NULL DEFAULT false; ALTER TABLE public.ads ADD COLUMN IF NOT EXISTS sample boolean NOT NULL DEFAULT false; COMMENT ON COLUMN public.listings.sample IS 'Registro ilustrativo importado do index original, não verificado como empresa real.'; COMMENT ON COLUMN public.ads.sample IS 'Propaganda demonstrativa importada do index original.';

-- Migration 20261026182134 yespark_ofertas_home_visibilidade_global

-- Configuração pública única para a seção de ofertas na home.
-- Não altera cadastros existentes.
CREATE TABLE IF NOT EXISTS public.site_settings (
  key text PRIMARY KEY CHECK (key = 'show_home_promos'),
  enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.site_settings(key,enabled)
VALUES ('show_home_promos',true)
ON CONFLICT (key) DO NOTHING;
REVOKE ALL ON public.site_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.site_settings TO anon,authenticated;
GRANT UPDATE (enabled) ON public.site_settings TO authenticated;
CREATE POLICY yespark_site_settings_public_read ON public.site_settings
 FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY yespark_site_settings_admin_update ON public.site_settings
 FOR UPDATE TO authenticated
 USING((select yespark_private.is_admin()))
 WITH CHECK((select yespark_private.is_admin()));


-- Migration 20261026184300 yespark_termos_privacidade_contato_responsavel
CREATE TABLE IF NOT EXISTS public.legal_contact (
 id smallint PRIMARY KEY DEFAULT 1 CHECK(id=1),
 controller_name text,
 contact_email text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT legal_contact_name_length CHECK(controller_name IS NULL OR char_length(controller_name) BETWEEN 3 AND 160),
 CONSTRAINT legal_contact_email_valid CHECK(contact_email IS NULL OR (char_length(contact_email) <= 254 AND contact_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}$'))
);
ALTER TABLE public.legal_contact ENABLE ROW LEVEL SECURITY;
INSERT INTO public.legal_contact(id,controller_name,contact_email)
 VALUES(1,NULL,NULL) ON CONFLICT(id) DO NOTHING;
REVOKE ALL ON public.legal_contact FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.legal_contact TO anon,authenticated;
GRANT UPDATE(controller_name,contact_email,updated_at) ON public.legal_contact TO authenticated;
CREATE POLICY yespark_legal_contact_public_read ON public.legal_contact
 FOR SELECT TO anon,authenticated USING (id=1);
CREATE POLICY yespark_legal_contact_admin_update ON public.legal_contact
 FOR UPDATE TO authenticated
 USING(id=1 AND (select yespark_private.is_admin()))
 WITH CHECK(id=1 AND (select yespark_private.is_admin()));


-- Migration 20261026184830 yespark_legal_email_constraint_correction
ALTER TABLE public.legal_contact DROP CONSTRAINT IF EXISTS legal_contact_email_valid; ALTER TABLE public.legal_contact ADD CONSTRAINT legal_contact_email_valid CHECK(contact_email IS NULL OR (char_length(contact_email) <= 254 AND contact_email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}$'));

-- Migration 20261026193501 yespark_categorias_dinamicas_instagram

ALTER TABLE public.listings
 ADD COLUMN IF NOT EXISTS instagram text NOT NULL DEFAULT '';
ALTER TABLE public.listings
 DROP CONSTRAINT IF EXISTS listings_instagram_format;
ALTER TABLE public.listings
 ADD CONSTRAINT listings_instagram_format CHECK (
   instagram = '' OR instagram ~ '^[A-Za-z0-9._]{1,30}$'
 );
CREATE TABLE IF NOT EXISTS public.listing_categories (
 kind text NOT NULL CHECK (kind IN ('empresa','servico')),
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 45 AND name=btrim(name)),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(kind,name)
);
CREATE UNIQUE INDEX IF NOT EXISTS listing_categories_kind_name_lower_uniq ON public.listing_categories(kind, lower(name));
ALTER TABLE public.listing_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_categories FROM public,anon,authenticated;
GRANT SELECT ON public.listing_categories TO anon,authenticated;
GRANT INSERT ON public.listing_categories TO authenticated;
CREATE POLICY listing_categories_read ON public.listing_categories FOR SELECT TO anon,authenticated USING(true);
CREATE POLICY listing_categories_admin_insert ON public.listing_categories FOR INSERT TO authenticated
 WITH CHECK((select yespark_private.is_admin()));


-- Migration 20261028174110 yespark_imagem_icone_perfil_empresa_proprietario

ALTER TABLE public.listings
 ADD COLUMN IF NOT EXISTS profile_image_url text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS profile_image_type text NOT NULL DEFAULT 'logo';
ALTER TABLE public.listings
 DROP CONSTRAINT IF EXISTS listings_profile_image_type_check;
ALTER TABLE public.listings
 ADD CONSTRAINT listings_profile_image_type_check
 CHECK (profile_image_type IN ('logo','proprietario','padrao'));
ALTER TABLE public.listings
 DROP CONSTRAINT IF EXISTS listings_profile_image_url_length_check;
ALTER TABLE public.listings
 ADD CONSTRAINT listings_profile_image_url_length_check
 CHECK (char_length(profile_image_url) <= 2048);


-- Migration 20261123184130 yespark_otimizacao_catalogo_paginado_indicadores_e_indices

CREATE INDEX IF NOT EXISTS idx_ads_listing_id ON public.ads(listing_id);
CREATE INDEX IF NOT EXISTS idx_banners_target_id ON public.banners(target_id);
CREATE INDEX IF NOT EXISTS idx_listings_public_recent ON public.listings(kind,created_at DESC,id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_listings_public_category ON public.listings(kind,category,created_at DESC) WHERE active;

CREATE OR REPLACE VIEW public.yespark_catalog_public
WITH (security_invoker = true) AS
SELECT l.*,
       COALESCE(rt.rating_count,0)::integer AS rating_count,
       COALESCE(rt.rating_avg,0)::numeric(4,2) AS rating_avg
FROM public.listings AS l
LEFT JOIN (
 SELECT listing_id,count(*) AS rating_count,avg(stars) AS rating_avg
 FROM public.reviews
 WHERE status='approved'
 GROUP BY listing_id
) AS rt ON rt.listing_id=l.id
WHERE l.active=true;

REVOKE ALL ON public.yespark_catalog_public FROM PUBLIC;
GRANT SELECT ON public.yespark_catalog_public TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.yespark_search_catalog(
 p_kind text,
 p_query text DEFAULT '',
 p_category text DEFAULT NULL,
 p_sort text DEFAULT 'recent',
 p_limit integer DEFAULT 16,
 p_offset integer DEFAULT 0
)
RETURNS SETOF public.yespark_catalog_public
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=''
AS $fn$
  SELECT v.*
  FROM public.yespark_catalog_public AS v
  WHERE v.kind IN ('empresa','servico')
    AND v.kind=p_kind
    AND (p_category IS NULL OR v.category=p_category)
    AND (COALESCE(p_query,'')='' OR
      v.name ILIKE '%'||p_query||'%' OR
      v.category ILIKE '%'||p_query||'%' OR
      v.description ILIKE '%'||p_query||'%')
  ORDER BY
    CASE WHEN p_sort='name' THEN lower(v.name) END ASC,
    CASE WHEN p_sort='count' THEN v.rating_count END DESC NULLS LAST,
    CASE WHEN p_sort='rating' THEN v.rating_avg END DESC NULLS LAST,
    v.created_at DESC, v.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit,16),1),32)
  OFFSET LEAST(GREATEST(COALESCE(p_offset,0),0),100000)
$fn$;

REVOKE ALL ON FUNCTION public.yespark_search_catalog(text,text,text,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.yespark_search_catalog(text,text,text,text,integer,integer)
TO anon,authenticated;


-- Migration 20261127174006 yespark_private_prelaunch_snapshot
create schema if not exists yespark_backup_private; revoke all on schema yespark_backup_private from public,anon,authenticated,service_role;
create table yespark_backup_private.snapshot_20261127 as select now() as captured_at, jsonb_build_object('admins',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.admins x),'listings',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.listings x),'ads',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.ads x),'banners',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.banners x),'reviews',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.reviews x),'review_throttles',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.review_throttles x),'site_settings',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.site_settings x),'legal_contact',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.legal_contact x),'listing_categories',(select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) from public.listing_categories x),'storage_inventory',(select coalesce(jsonb_agg(jsonb_build_object('bucket_id',bucket_id,'name',name,'metadata',metadata)),'[]'::jsonb) from storage.objects where bucket_id='yespark-media'),'catalog_rpc',(select pg_get_functiondef('public.yespark_search_catalog(text,text,text,text,integer,integer)'::regprocedure)), 'grants',(select jsonb_agg(to_jsonb(g)) from information_schema.role_table_grants g where table_schema='public' and grantee in ('anon','authenticated','service_role','PUBLIC'))) as payload;
revoke all on all tables in schema yespark_backup_private from public,anon,authenticated,service_role;
alter table yespark_backup_private.snapshot_20261127 enable row level security;

-- Migration 20261127174027 yespark_prelaunch_least_privilege_and_catalog_pagination
revoke insert,update,delete,truncate,references,trigger on public.listings,public.ads,public.banners,public.reviews,public.yespark_catalog_public from anon;
revoke truncate,references,trigger on public.listings,public.ads,public.banners from authenticated;
revoke insert,truncate,references,trigger on public.reviews from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.yespark_catalog_public from authenticated;
grant update on public.legal_contact to authenticated;
CREATE OR REPLACE FUNCTION public.yespark_search_catalog(p_kind text, p_query text DEFAULT ''::text,p_category text DEFAULT NULL::text,p_sort text DEFAULT 'recent'::text,p_limit integer DEFAULT 16,p_offset integer DEFAULT 0)
RETURNS SETOF public.yespark_catalog_public LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO '' AS $fn$
BEGIN
 IF p_sort IN ('rating','count','name') THEN
 RETURN QUERY SELECT v.* FROM public.yespark_catalog_public v
 WHERE v.kind IN ('empresa','servico') AND v.kind=p_kind AND (p_category IS NULL OR v.category=p_category)
 AND (coalesce(p_query,'')='' OR v.name ILIKE '%'||p_query||'%' OR v.category ILIKE '%'||p_query||'%' OR v.description ILIKE '%'||p_query||'%')
 ORDER BY CASE WHEN p_sort='name' THEN lower(v.name) END ASC,CASE WHEN p_sort='count' THEN v.rating_count END DESC NULLS LAST,CASE WHEN p_sort='rating' THEN v.rating_avg END DESC NULLS LAST,v.created_at DESC,v.id
 LIMIT least(greatest(coalesce(p_limit,16),1),32) OFFSET least(greatest(coalesce(p_offset,0),0),100000);
 ELSE
 RETURN QUERY SELECT l.id,l.kind,l.name,l.category,l.description,l.phone,l.image_url,l.active,l.created_at,l.sample,l.instagram,l.profile_image_url,l.profile_image_type,coalesce(rt.rating_count,0)::integer,coalesce(rt.rating_avg,0)::numeric(4,2)
 FROM (SELECT x.* FROM public.listings x WHERE x.active AND x.kind IN ('empresa','servico') AND x.kind=p_kind AND (p_category IS NULL OR x.category=p_category)
 AND (coalesce(p_query,'')='' OR x.name ILIKE '%'||p_query||'%' OR x.category ILIKE '%'||p_query||'%' OR x.description ILIKE '%'||p_query||'%')
 ORDER BY x.created_at DESC,x.id LIMIT least(greatest(coalesce(p_limit,16),1),32) OFFSET least(greatest(coalesce(p_offset,0),0),100000)) l
 LEFT JOIN LATERAL (SELECT count(*) rating_count,avg(r.stars) rating_avg FROM public.reviews r WHERE r.listing_id=l.id AND r.status='approved') rt ON true
 ORDER BY l.created_at DESC,l.id;
 END IF;
END $fn$;


-- Migration 20261127175704 yespark_admin_backup_and_safe_restore
create or replace function public.yespark_export_backup()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if not yespark_private.is_admin() then raise exception 'Acesso administrativo necessario' using errcode='42501'; end if;
 return jsonb_build_object('tables',jsonb_build_object('listing_categories',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.listing_categories t),
'listings',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.listings t),
'ads',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.ads t),
'banners',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.banners t),
'reviews',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.reviews t),
'site_settings',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.site_settings t),
'legal_contact',(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.legal_contact t)), 'media',(select coalesce(jsonb_agg(jsonb_build_object('name',o.name,'size',(o.metadata->>'size')::bigint,'type',o.metadata->>'mimetype','etag',o.metadata->>'eTag') order by o.name),'[]'::jsonb) from storage.objects o where o.bucket_id='yespark-media'));
end $$;
revoke all on function public.yespark_export_backup() from public,anon,authenticated;
grant execute on function public.yespark_export_backup() to authenticated;
create or replace function yespark_private.restore_backup(p_tables jsonb,p_apply boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t text; n int; total int; result jsonb:='{}'; allowed constant text[]:=array['listing_categories','listings','ads','banners','reviews','site_settings','legal_contact'];
begin
 if not yespark_private.is_admin() then raise exception 'Acesso administrativo necessario' using errcode='42501'; end if;
 if p_apply is null or jsonb_typeof(p_tables) is distinct from 'object' or octet_length(p_tables::text)>10000000 then raise exception 'Backup invalido ou acima do limite'; end if;
 if (select count(*) from jsonb_object_keys(p_tables))<>7 then raise exception 'Tabelas invalidas'; end if;
 perform pg_advisory_xact_lock(15987654);
 begin
 foreach t in array allowed loop
  if jsonb_typeof(p_tables->t) is distinct from 'array' then raise exception 'Tabela ausente ou invalida: %',t; end if;
  total:=jsonb_array_length(p_tables->t);
  if total>20000 then raise exception 'Limite de registros excedido: %',t; end if;
  execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I,$1) on conflict do nothing',t,t) using p_tables->t;
  get diagnostics n=row_count;
  result:=result||jsonb_build_object(t,jsonb_build_object('inserted',n,'skipped',total-n));
 end loop;
 if not p_apply then raise exception using errcode='ZX002',message='dry run'; end if;
 exception when sqlstate 'ZX002' then null;
 end;
 return result;
end $$;
revoke all on function yespark_private.restore_backup(jsonb,boolean) from public,anon,authenticated;
grant execute on function yespark_private.restore_backup(jsonb,boolean) to authenticated;
create or replace function public.yespark_restore_backup(p_tables jsonb,p_apply boolean default false)
returns jsonb language sql security invoker set search_path='' as $$ select yespark_private.restore_backup(p_tables,p_apply) $$;
revoke all on function public.yespark_restore_backup(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.yespark_restore_backup(jsonb,boolean) to authenticated;
