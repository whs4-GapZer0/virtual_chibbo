BEGIN;
SET ROLE chibbo_owner;
SET search_path = chibbo, pg_catalog;
CREATE FUNCTION create_public_draft(p_company_slug text, p_job_slug text, p_name text, p_email text, p_notice_version text, p_secret_hash text, p_pepper_version text, p_intent_id uuid, p_receipt text, p_media_type text, p_expires_at timestamptz)
RETURNS TABLE(application_id uuid, company_id uuid, object_key text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$
DECLARE v_job job_posts; v_company_id uuid; v_app_id uuid; BEGIN
 SELECT id INTO v_company_id FROM companies WHERE slug=p_company_slug AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 PERFORM set_config('app.company_id', v_company_id::text, true);
 SELECT jp.* INTO v_job FROM job_posts jp WHERE jp.company_id=v_company_id AND jp.slug=p_job_slug AND jp.published_at IS NOT NULL AND (jp.closes_at IS NULL OR jp.closes_at > now());
 IF NOT FOUND THEN RAISE EXCEPTION 'not found' USING ERRCODE='P0002'; END IF;
 INSERT INTO applications(company_id,job_post_id,receipt_number,deletion_secret_hash,deletion_secret_pepper_version,applicant_name,applicant_email,privacy_notice_version,notice_acknowledged_at) VALUES(v_job.company_id,v_job.id,p_receipt,p_secret_hash,p_pepper_version,p_name,p_email,p_notice_version,now()) RETURNING id INTO v_app_id;
 INSERT INTO receipt_routes(receipt_number,company_id) VALUES(p_receipt,v_job.company_id);
 INSERT INTO upload_intents(id,company_id,application_id,object_key,expected_media_type,expires_at) VALUES(p_intent_id,v_job.company_id,v_app_id,'quarantine/' || p_intent_id::text,p_media_type,p_expires_at);
 RETURN QUERY SELECT v_app_id,v_job.company_id,'quarantine/' || p_intent_id::text; END; $$;
REVOKE ALL ON FUNCTION create_public_draft(text,text,text,text,text,text,text,uuid,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_public_draft(text,text,text,text,text,text,text,uuid,text,text,timestamptz) TO chibbo_app;
CREATE FUNCTION list_published_jobs() RETURNS TABLE(company_slug text, company_name text, job_slug text, title text, description text, work_type text) LANGUAGE sql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$ SELECT c.slug, c.name, jp.slug, jp.title, jp.description, jp.work_type FROM job_posts jp JOIN companies c ON c.id=jp.company_id WHERE c.status='active' AND jp.published_at IS NOT NULL AND (jp.closes_at IS NULL OR jp.closes_at > now()) ORDER BY c.slug, jp.created_at $$;
CREATE FUNCTION get_published_job(p_company_slug text, p_job_slug text) RETURNS TABLE(company_slug text, company_name text, job_slug text, title text, description text, work_type text) LANGUAGE sql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$ SELECT c.slug, c.name, jp.slug, jp.title, jp.description, jp.work_type FROM job_posts jp JOIN companies c ON c.id=jp.company_id WHERE c.slug=p_company_slug AND jp.slug=p_job_slug AND c.status='active' AND jp.published_at IS NOT NULL AND (jp.closes_at IS NULL OR jp.closes_at > now()) $$;
REVOKE ALL ON FUNCTION list_published_jobs(), get_published_job(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_published_jobs(), get_published_job(text,text) TO chibbo_app;
CREATE FUNCTION consume_deletion_request(p_receipt text, p_secret_hash text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$ DECLARE v_company_id uuid; v_app applications; BEGIN SELECT company_id INTO v_company_id FROM receipt_routes WHERE receipt_number=p_receipt; IF NOT FOUND THEN RETURN false; END IF; PERFORM set_config('app.company_id',v_company_id::text,true); SELECT * INTO v_app FROM applications WHERE receipt_number=p_receipt AND deletion_secret_hash=p_secret_hash AND deletion_secret_used_at IS NULL FOR UPDATE; IF NOT FOUND THEN RETURN false; END IF; UPDATE applications SET deletion_secret_used_at=now() WHERE id=v_app.id AND deletion_secret_used_at IS NULL; INSERT INTO privacy_requests(company_id,application_id,request_type,status) VALUES(v_app.company_id,v_app.id,'deletion','received'); INSERT INTO audit_events(company_id,correlation_id,event_scope,event_source,action,target_type,target_id) VALUES(v_app.company_id,gen_random_uuid(),'recruitment-service','privacy-request','privacy.deletion_requested','application',v_app.id); RETURN true; END; $$;
REVOKE ALL ON FUNCTION consume_deletion_request(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_deletion_request(text,text) TO chibbo_app;
CREATE FUNCTION resolve_active_session(p_hash text) RETURNS TABLE(entra_tenant_id uuid, entra_object_id uuid, company_id uuid, role membership_role, membership_version integer) LANGUAGE sql SECURITY DEFINER SET search_path = chibbo, pg_catalog AS $$ SELECT m.entra_tenant_id,m.entra_object_id,m.company_id,m.role,m.membership_version FROM sessions s JOIN memberships m ON m.entra_tenant_id=s.entra_tenant_id AND m.entra_object_id=s.entra_object_id WHERE s.id_hash=p_hash AND s.revoked_at IS NULL AND s.idle_expires_at>now() AND s.absolute_expires_at>now() AND m.active AND m.membership_version=s.membership_version $$;
REVOKE ALL ON FUNCTION resolve_active_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_active_session(text) TO chibbo_app;
RESET ROLE;
COMMIT;
