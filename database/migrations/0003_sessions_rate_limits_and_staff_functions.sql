BEGIN;
SET ROLE chibbo_owner;
SET search_path = chibbo, pg_catalog;

CREATE TABLE rate_limit_events (
  id bigserial PRIMARY KEY,
  scope text NOT NULL,
  subject_hash text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rate_limit_events_window_idx ON rate_limit_events(scope, subject_hash, occurred_at);
REVOKE ALL ON rate_limit_events FROM PUBLIC;

CREATE FUNCTION create_staff_session(p_hash text, p_tenant_id uuid, p_object_id uuid)
RETURNS TABLE(company_id uuid, role membership_role, membership_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
DECLARE v_membership memberships;
BEGIN
  SELECT m.* INTO v_membership FROM memberships m WHERE m.entra_tenant_id=p_tenant_id AND m.entra_object_id=p_object_id AND m.active
  ORDER BY CASE WHEN m.role='platform-admin' THEN 0 ELSE 1 END LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
  INSERT INTO sessions(id_hash,entra_tenant_id,entra_object_id,membership_version,idle_expires_at,absolute_expires_at)
  VALUES(p_hash,p_tenant_id,p_object_id,v_membership.membership_version,now()+interval '30 minutes',now()+interval '8 hours');
  RETURN QUERY SELECT v_membership.company_id,v_membership.role,v_membership.membership_version;
END; $$;

CREATE OR REPLACE FUNCTION resolve_active_session(p_hash text)
RETURNS TABLE(entra_tenant_id uuid, entra_object_id uuid, company_id uuid, role membership_role, membership_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
BEGIN
  UPDATE sessions SET idle_expires_at=now()+interval '30 minutes'
  WHERE id_hash=p_hash AND revoked_at IS NULL AND idle_expires_at>now() AND absolute_expires_at>now();
  RETURN QUERY SELECT m.entra_tenant_id,m.entra_object_id,m.company_id,m.role,m.membership_version
  FROM sessions s JOIN memberships m ON m.entra_tenant_id=s.entra_tenant_id AND m.entra_object_id=s.entra_object_id
  WHERE s.id_hash=p_hash AND s.revoked_at IS NULL AND s.idle_expires_at>now() AND s.absolute_expires_at>now() AND m.active AND m.membership_version=s.membership_version;
END; $$;

CREATE FUNCTION consume_rate_limit(p_scope text, p_subject_hash text, p_window_seconds integer, p_max integer)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
DECLARE v_count integer; v_oldest timestamptz;
BEGIN
  IF p_scope NOT IN ('upload-init','upload-finalize','deletion') OR p_window_seconds < 1 OR p_window_seconds > 86400 OR p_max < 1 OR p_max > 10000 OR length(p_subject_hash) <> 64 THEN RAISE EXCEPTION 'invalid rate limit request'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_scope || ':' || p_subject_hash, 0));
  DELETE FROM rate_limit_events WHERE occurred_at < now() - interval '2 days';
  SELECT count(*), min(occurred_at) INTO v_count, v_oldest FROM rate_limit_events WHERE scope=p_scope AND subject_hash=p_subject_hash AND occurred_at > now() - make_interval(secs => p_window_seconds);
  IF v_count >= p_max THEN RETURN QUERY SELECT false, greatest(1, ceil(extract(epoch FROM (v_oldest + make_interval(secs => p_window_seconds) - now())))::integer); RETURN; END IF;
  INSERT INTO rate_limit_events(scope,subject_hash) VALUES(p_scope,p_subject_hash);
  RETURN QUERY SELECT true, 0;
END; $$;

CREATE FUNCTION list_staff_applications() RETURNS TABLE(id uuid, receipt_number text, applicant_name text, job_title text, status application_status, row_version integer, created_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
  SELECT a.id,a.receipt_number,a.applicant_name,j.title,a.status,a.row_version,a.created_at FROM applications a JOIN job_posts j ON j.id=a.job_post_id
  WHERE tenant_matches(a.company_id) ORDER BY a.created_at DESC
$$;
CREATE FUNCTION get_staff_application(p_application_id uuid) RETURNS TABLE(id uuid, receipt_number text, applicant_name text, applicant_email text, job_title text, status application_status, row_version integer, created_at timestamptz, resume_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
  SELECT a.id,a.receipt_number,a.applicant_name,a.applicant_email,j.title,a.status,a.row_version,a.created_at,r.id FROM applications a JOIN job_posts j ON j.id=a.job_post_id LEFT JOIN resumes r ON r.application_id=a.id
  WHERE a.id=p_application_id AND tenant_matches(a.company_id)
$$;
CREATE FUNCTION list_admin_companies() RETURNS TABLE(id uuid, name text, slug text, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$ BEGIN IF current_setting('app.actor_role',true) <> 'platform-admin' THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF; RETURN QUERY SELECT c.id,c.name,c.slug,c.status FROM companies c ORDER BY c.name; END $$;
CREATE FUNCTION list_admin_memberships(p_company_id uuid) RETURNS TABLE(id uuid, entra_tenant_id uuid, entra_object_id uuid, role membership_role, active boolean, membership_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$ BEGIN IF current_setting('app.actor_role',true) <> 'platform-admin' THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF; RETURN QUERY SELECT m.id,m.entra_tenant_id,m.entra_object_id,m.role,m.active,m.membership_version FROM memberships m WHERE m.company_id=p_company_id ORDER BY m.id; END $$;
CREATE FUNCTION upsert_admin_membership(p_company_id uuid, p_tenant_id uuid, p_object_id uuid, p_role membership_role, p_active boolean)
RETURNS TABLE(id uuid, membership_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
DECLARE v_id uuid; v_version integer;
BEGIN
  IF current_setting('app.actor_role',true) <> 'platform-admin' OR NOT EXISTS (SELECT 1 FROM companies WHERE id=p_company_id) THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
  UPDATE memberships SET active=false,membership_version=membership_version+1 WHERE entra_tenant_id=p_tenant_id AND entra_object_id=p_object_id AND company_id=p_company_id AND role <> p_role AND active;
  INSERT INTO memberships(entra_tenant_id,entra_object_id,company_id,role,active)
  VALUES(p_tenant_id,p_object_id,p_company_id,p_role,p_active)
  ON CONFLICT (entra_tenant_id,entra_object_id,role,company_id) DO UPDATE SET active=EXCLUDED.active,membership_version=memberships.membership_version+1
  RETURNING memberships.id,memberships.membership_version INTO v_id,v_version;
  UPDATE sessions SET revoked_at=now() WHERE entra_tenant_id=p_tenant_id AND entra_object_id=p_object_id AND revoked_at IS NULL;
  RETURN QUERY SELECT v_id,v_version;
END $$;
REVOKE ALL ON FUNCTION create_staff_session(text,uuid,uuid), consume_rate_limit(text,text,integer,integer), list_staff_applications(), get_staff_application(uuid), list_admin_companies(), list_admin_memberships(uuid), upsert_admin_membership(uuid,uuid,uuid,membership_role,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_staff_session(text,uuid,uuid), consume_rate_limit(text,text,integer,integer), list_staff_applications(), get_staff_application(uuid), list_admin_companies(), list_admin_memberships(uuid), upsert_admin_membership(uuid,uuid,uuid,membership_role,boolean) TO chibbo_app;
RESET ROLE;
COMMIT;
