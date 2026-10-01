-- Run as chibbo_migrator, which is granted a narrowly scoped SET ROLE chibbo_owner.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA IF NOT EXISTS chibbo AUTHORIZATION chibbo_owner;
REVOKE ALL ON SCHEMA chibbo FROM PUBLIC;
SET ROLE chibbo_owner;
SET search_path = chibbo, pg_catalog;

CREATE TYPE application_status AS ENUM ('draft_upload','submitted','reviewing','accepted','rejected');
CREATE TYPE upload_state AS ENUM ('issued','uploaded','verifying','finalized','rejected','expired');
CREATE TYPE membership_role AS ENUM ('company-manager','platform-admin');
CREATE TABLE companies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, slug text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE job_posts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), slug text NOT NULL, title text NOT NULL, description text NOT NULL, work_type text NOT NULL, closes_at timestamptz, published_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(company_id, slug));
CREATE TABLE applications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), job_post_id uuid NOT NULL REFERENCES job_posts(id), receipt_number text NOT NULL UNIQUE, deletion_secret_hash text NOT NULL, deletion_secret_pepper_version text NOT NULL, deletion_secret_used_at timestamptz, applicant_name text NOT NULL, applicant_email text NOT NULL, status application_status NOT NULL DEFAULT 'draft_upload', row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0), privacy_notice_version text NOT NULL, notice_acknowledged_at timestamptz NOT NULL, deletion_due_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE receipt_routes (receipt_number text PRIMARY KEY, company_id uuid NOT NULL REFERENCES companies(id));
CREATE TABLE upload_intents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), application_id uuid NOT NULL UNIQUE REFERENCES applications(id), object_key text NOT NULL UNIQUE, object_version_id text, expected_media_type text NOT NULL, expires_at timestamptz NOT NULL, state upload_state NOT NULL DEFAULT 'issued', failure_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE resumes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), application_id uuid NOT NULL UNIQUE REFERENCES applications(id), upload_intent_id uuid NOT NULL UNIQUE REFERENCES upload_intents(id), bucket text NOT NULL, object_key text NOT NULL, object_version_id text NOT NULL, sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'), media_type text NOT NULL, size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880), verification_status text NOT NULL CHECK (verification_status = 'accepted'), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entra_tenant_id uuid NOT NULL, entra_object_id uuid NOT NULL, company_id uuid REFERENCES companies(id), role membership_role NOT NULL, active boolean NOT NULL DEFAULT true, membership_version integer NOT NULL DEFAULT 1, UNIQUE(entra_tenant_id, entra_object_id, role, company_id));
CREATE TABLE sessions (id_hash text PRIMARY KEY, entra_tenant_id uuid NOT NULL, entra_object_id uuid NOT NULL, membership_version integer NOT NULL, idle_expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL, revoked_at timestamptz);
CREATE TABLE application_status_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), application_id uuid NOT NULL REFERENCES applications(id), actor_tenant_id uuid NOT NULL, actor_object_id uuid NOT NULL, from_status application_status NOT NULL, to_status application_status NOT NULL, expected_row_version integer NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE privacy_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL REFERENCES companies(id), application_id uuid NOT NULL REFERENCES applications(id), request_type text NOT NULL CHECK (request_type = 'deletion'), status text NOT NULL DEFAULT 'received', requested_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);
CREATE TABLE audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid REFERENCES companies(id), correlation_id uuid NOT NULL, event_scope text NOT NULL CHECK (event_scope IN ('legal-corporation','recruitment-service','recruitment-platform','internal-hr','asset-management')), event_source text NOT NULL, action text NOT NULL, target_type text NOT NULL, target_id text NOT NULL, metadata_json jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now());

CREATE FUNCTION current_company_id() RETURNS uuid LANGUAGE plpgsql STABLE AS $$
BEGIN
  RETURN NULLIF(current_setting('app.company_id', true), '')::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$;
CREATE FUNCTION tenant_matches(row_company_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT chibbo.current_company_id() IS NOT NULL AND row_company_id = chibbo.current_company_id() $$;
REVOKE ALL ON FUNCTION current_company_id(), tenant_matches(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_company_id(), tenant_matches(uuid) TO chibbo_app;

ALTER TABLE job_posts ENABLE ROW LEVEL SECURITY; ALTER TABLE job_posts FORCE ROW LEVEL SECURITY;
ALTER TABLE applications ENABLE ROW LEVEL SECURITY; ALTER TABLE applications FORCE ROW LEVEL SECURITY;
ALTER TABLE upload_intents ENABLE ROW LEVEL SECURITY; ALTER TABLE upload_intents FORCE ROW LEVEL SECURITY;
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY; ALTER TABLE resumes FORCE ROW LEVEL SECURITY;
ALTER TABLE application_status_events ENABLE ROW LEVEL SECURITY; ALTER TABLE application_status_events FORCE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY; ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY job_posts_tenant ON job_posts USING (tenant_matches(company_id)) WITH CHECK (tenant_matches(company_id));
CREATE POLICY job_posts_public_read ON job_posts FOR SELECT USING (published_at IS NOT NULL AND (closes_at IS NULL OR closes_at > now()));
CREATE POLICY applications_tenant ON applications USING (tenant_matches(company_id)) WITH CHECK (tenant_matches(company_id));
CREATE POLICY upload_intents_tenant ON upload_intents USING (tenant_matches(company_id)) WITH CHECK (tenant_matches(company_id));
CREATE POLICY resumes_tenant ON resumes USING (tenant_matches(company_id)) WITH CHECK (tenant_matches(company_id));
CREATE POLICY application_status_events_tenant ON application_status_events USING (tenant_matches(company_id)) WITH CHECK (tenant_matches(company_id));
CREATE POLICY privacy_requests_tenant ON privacy_requests USING (tenant_matches(company_id)) WITH CHECK (tenant_matches(company_id));
CREATE POLICY audit_events_tenant ON audit_events USING (company_id IS NULL OR tenant_matches(company_id)) WITH CHECK (company_id IS NULL OR tenant_matches(company_id));

REVOKE ALL ON ALL TABLES IN SCHEMA chibbo FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA chibbo FROM PUBLIC;
GRANT USAGE ON SCHEMA chibbo TO chibbo_app;
GRANT SELECT, INSERT, UPDATE ON job_posts, applications, upload_intents, resumes, application_status_events, privacy_requests, audit_events TO chibbo_app;
-- No ownership, CREATE, BYPASSRLS, or SET ROLE is granted to chibbo_app.
RESET ROLE;
COMMIT;
