-- Synthetic Chibbo PoC seed. It is intentionally idempotent so the approved
-- initial-environment migration can be retried without duplicating public jobs.
SET ROLE chibbo_owner;
SET search_path = chibbo, pg_catalog;
INSERT INTO companies (id,name,slug) VALUES ('00000000-0000-4000-8000-000000000001','알파웍스','alpha-works'), ('00000000-0000-4000-8000-000000000002','베타스튜디오','beta-studio')
ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, slug=EXCLUDED.slug, status='active';
BEGIN;
SELECT set_config('app.company_id', '00000000-0000-4000-8000-000000000001', true);
INSERT INTO job_posts (company_id,slug,title,description,work_type,published_at) VALUES ('00000000-0000-4000-8000-000000000001','support-engineer','고객지원 엔지니어','고객 문의 해결과 지원 품질 개선을 함께합니다.','정규직',now()), ('00000000-0000-4000-8000-000000000001','backend-engineer','백엔드 엔지니어','채용지원 서비스의 안정적인 기반을 만듭니다.','정규직',now())
ON CONFLICT (company_id,slug) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, work_type=EXCLUDED.work_type, published_at=EXCLUDED.published_at;
SELECT set_config('app.company_id', '00000000-0000-4000-8000-000000000002', true);
INSERT INTO job_posts (company_id,slug,title,description,work_type,published_at) VALUES ('00000000-0000-4000-8000-000000000002','product-designer','프로덕트 디자이너','지원자와 채용 담당자의 흐름을 설계합니다.','계약직',now())
ON CONFLICT (company_id,slug) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description, work_type=EXCLUDED.work_type, published_at=EXCLUDED.published_at;
COMMIT;
RESET ROLE;
