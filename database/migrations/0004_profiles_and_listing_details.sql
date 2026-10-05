-- Expand migration: richer company/job listing fields and applicant profile
-- fields. Every new column is nullable or defaulted, and every replaced
-- function returns a superset of its previous columns, so the previous
-- application image keeps working while this migration is applied first.
BEGIN;
SET ROLE chibbo_owner;
SET search_path = chibbo, pg_catalog;

ALTER TABLE companies
  ADD COLUMN tagline text,
  ADD COLUMN description text,
  ADD COLUMN industry text,
  ADD COLUMN location text,
  ADD COLUMN employee_scale text,
  ADD COLUMN founded_year integer CHECK (founded_year BETWEEN 1900 AND 2100),
  ADD COLUMN homepage_url text,
  ADD COLUMN benefits text[] NOT NULL DEFAULT '{}';

ALTER TABLE job_posts
  ADD COLUMN department text,
  ADD COLUMN location text,
  ADD COLUMN career_level text,
  ADD COLUMN salary_range text,
  ADD COLUMN headcount integer CHECK (headcount > 0),
  ADD COLUMN responsibilities text[] NOT NULL DEFAULT '{}',
  ADD COLUMN requirements text[] NOT NULL DEFAULT '{}',
  ADD COLUMN preferred text[] NOT NULL DEFAULT '{}',
  ADD COLUMN hiring_process text[] NOT NULL DEFAULT '{}',
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}';

-- Applicant profile fields are personal data. They stay behind the same
-- tenant RLS policy as the rest of the applications row.
ALTER TABLE applications
  ADD COLUMN applicant_phone text CHECK (applicant_phone ~ '^[0-9+() -]{7,20}$'),
  ADD COLUMN applicant_birth_date date,
  ADD COLUMN applicant_address text,
  ADD COLUMN education text,
  ADD COLUMN career_years integer CHECK (career_years BETWEEN 0 AND 60),
  ADD COLUMN current_company text,
  ADD COLUMN career_summary text;

-- Public listing functions: the return type grows, so they are dropped and
-- recreated inside this transaction. Callers that select the old columns by
-- name are unaffected.
DROP FUNCTION list_published_jobs();
DROP FUNCTION get_published_job(text, text);
CREATE FUNCTION list_published_jobs() RETURNS TABLE(company_slug text, company_name text, job_slug text, title text, description text, work_type text, company_industry text, department text, location text, career_level text, salary_range text, tags text[], closes_at timestamptz, published_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
  SELECT c.slug, c.name, jp.slug, jp.title, jp.description, jp.work_type, c.industry, jp.department, jp.location, jp.career_level, jp.salary_range, jp.tags, jp.closes_at, jp.published_at
  FROM job_posts jp JOIN companies c ON c.id=jp.company_id
  WHERE c.status='active' AND jp.published_at IS NOT NULL AND (jp.closes_at IS NULL OR jp.closes_at > now())
  ORDER BY jp.published_at DESC, c.slug, jp.slug
$$;
CREATE FUNCTION get_published_job(p_company_slug text, p_job_slug text) RETURNS TABLE(company_slug text, company_name text, job_slug text, title text, description text, work_type text, company_industry text, department text, location text, career_level text, salary_range text, tags text[], closes_at timestamptz, published_at timestamptz, headcount integer, responsibilities text[], requirements text[], preferred text[], hiring_process text[], company_tagline text, company_description text, company_location text, company_employee_scale text, company_founded_year integer, company_homepage_url text, company_benefits text[])
LANGUAGE sql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
  SELECT c.slug, c.name, jp.slug, jp.title, jp.description, jp.work_type, c.industry, jp.department, jp.location, jp.career_level, jp.salary_range, jp.tags, jp.closes_at, jp.published_at, jp.headcount, jp.responsibilities, jp.requirements, jp.preferred, jp.hiring_process, c.tagline, c.description, c.location, c.employee_scale, c.founded_year, c.homepage_url, c.benefits
  FROM job_posts jp JOIN companies c ON c.id=jp.company_id
  WHERE c.slug=p_company_slug AND jp.slug=p_job_slug AND c.status='active' AND jp.published_at IS NOT NULL AND (jp.closes_at IS NULL OR jp.closes_at > now())
$$;
REVOKE ALL ON FUNCTION list_published_jobs(), get_published_job(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_published_jobs(), get_published_job(text,text) TO chibbo_app;

-- Phone-aware draft creation is a new overload; the 11-argument function from
-- 0002 stays until a later contract migration.
CREATE FUNCTION create_public_draft(p_company_slug text, p_job_slug text, p_name text, p_email text, p_notice_version text, p_secret_hash text, p_pepper_version text, p_intent_id uuid, p_receipt text, p_media_type text, p_expires_at timestamptz, p_phone text)
RETURNS TABLE(application_id uuid, company_id uuid, object_key text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
DECLARE v_app_id uuid; v_company_id uuid; v_object_key text; BEGIN
 SELECT d.application_id, d.company_id, d.object_key INTO v_app_id, v_company_id, v_object_key
 FROM create_public_draft(p_company_slug, p_job_slug, p_name, p_email, p_notice_version, p_secret_hash, p_pepper_version, p_intent_id, p_receipt, p_media_type, p_expires_at) d;
 UPDATE applications SET applicant_phone=p_phone WHERE id=v_app_id;
 RETURN QUERY SELECT v_app_id, v_company_id, v_object_key; END; $$;
REVOKE ALL ON FUNCTION create_public_draft(text,text,text,text,text,text,text,uuid,text,text,timestamptz,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_public_draft(text,text,text,text,text,text,text,uuid,text,text,timestamptz,text) TO chibbo_app;

-- Staff list: contact details are masked in the database so the list API never
-- carries full contact data; the detail function returns the full profile.
CREATE FUNCTION mask_email(p_email text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_email IS NULL OR position('@' in p_email) < 2 THEN p_email
    ELSE left(p_email, least(2, position('@' in p_email) - 1)) || '***' || substr(p_email, position('@' in p_email)) END
$$;
CREATE FUNCTION mask_phone(p_phone text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_phone IS NULL OR length(p_phone) < 8 THEN p_phone
    ELSE left(p_phone, 3) || regexp_replace(substr(p_phone, 4, length(p_phone) - 7), '[0-9]', '*', 'g') || right(p_phone, 4) END
$$;
REVOKE ALL ON FUNCTION mask_email(text), mask_phone(text) FROM PUBLIC;

DROP FUNCTION list_staff_applications();
DROP FUNCTION get_staff_application(uuid);
CREATE FUNCTION list_staff_applications() RETURNS TABLE(id uuid, receipt_number text, applicant_name text, job_title text, status application_status, row_version integer, created_at timestamptz, applicant_email_masked text, applicant_phone_masked text, career_years integer, education text, current_company text)
LANGUAGE sql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
  SELECT a.id,a.receipt_number,a.applicant_name,j.title,a.status,a.row_version,a.created_at,mask_email(a.applicant_email),mask_phone(a.applicant_phone),a.career_years,a.education,a.current_company
  FROM applications a JOIN job_posts j ON j.id=a.job_post_id
  WHERE tenant_matches(a.company_id) ORDER BY a.created_at DESC
$$;
CREATE FUNCTION get_staff_application(p_application_id uuid) RETURNS TABLE(id uuid, receipt_number text, applicant_name text, applicant_email text, job_title text, status application_status, row_version integer, created_at timestamptz, resume_id uuid, applicant_phone text, applicant_birth_date date, applicant_address text, education text, career_years integer, current_company text, career_summary text, privacy_notice_version text, notice_acknowledged_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
  SELECT a.id,a.receipt_number,a.applicant_name,a.applicant_email,j.title,a.status,a.row_version,a.created_at,r.id,a.applicant_phone,a.applicant_birth_date,a.applicant_address,a.education,a.career_years,a.current_company,a.career_summary,a.privacy_notice_version,a.notice_acknowledged_at
  FROM applications a JOIN job_posts j ON j.id=a.job_post_id LEFT JOIN resumes r ON r.application_id=a.id
  WHERE a.id=p_application_id AND tenant_matches(a.company_id)
$$;
REVOKE ALL ON FUNCTION list_staff_applications(), get_staff_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_staff_applications(), get_staff_application(uuid) TO chibbo_app;
RESET ROLE;
COMMIT;
