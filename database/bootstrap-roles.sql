-- One-time RDS bootstrap, run by the dedicated RDS master user before database/migrations.
-- The application task must receive only chibbo_app credentials; do not use this file at runtime.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chibbo_owner') THEN CREATE ROLE chibbo_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chibbo_migrator') THEN CREATE ROLE chibbo_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chibbo_app') THEN CREATE ROLE chibbo_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF;
END $$;
-- Existing roles may have been created in a prior interrupted bootstrap. The RDS
-- master can safely repair login state, while creation above fixes privilege flags.
ALTER ROLE chibbo_owner NOLOGIN;
ALTER ROLE chibbo_migrator LOGIN;
ALTER ROLE chibbo_app LOGIN;
GRANT chibbo_owner TO chibbo_migrator;
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT, TEMPORARY, CREATE ON DATABASE %I TO chibbo_migrator', current_database());
END $$;
DO $$ BEGIN
  IF pg_has_role('chibbo_app', 'chibbo_owner', 'member') THEN REVOKE chibbo_owner FROM chibbo_app; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
