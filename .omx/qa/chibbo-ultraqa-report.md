# UltraQA Report

> **Current re-run status (04:20–04:22 KST):** This addendum supersedes every earlier scenario row, failure, and verdict below. The latest tree passed 26 tests, lint, typecheck, production build, and CDK synth against `chibbo_qa_rls_20261001_0340`. Current stop condition is only the staff-session SQL defect recorded at the end of this document.

## Goal and success criteria

- Goal: Independently verify the Chibbo recruitment-service implementation after Stage 2, including tenant boundaries, upload capability behavior, event-instance ownership, infrastructure isolation, and deployment gates.
- Stop condition: all runnable baseline and adversarial scenarios pass, or a concrete product finding / external-environment verification boundary is recorded without claiming success.
- Safety bounds applied: no product, infrastructure, credential, AWS, Entra, GitHub, or database-schema changes. Only this report is written. The pre-existing isolated test database is used only for read/test execution.

## Scenario matrix

| ID | User/attacker model | Scenario | Command/harness | Expected signal | Actual result | Status | Evidence | Cleanup |
|---|---|---|---|---|---|---|---|---|
| QA-01 | normal developer | Full repository baseline | `pnpm test`, twice | selected suites pass twice; no hidden failures | 13 passing tests each run; PostgreSQL integration suite skipped | PARTIAL | 04:00 / 04:03 command output | no generated artifact |
| QA-02 | normal developer | Type/lint/build/synth baseline | `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm infra:synth` | all commands exit 0 | all exited 0; synth reports Node 24 unsupported warning and default ECS minHealthyPercent warning | PASS WITH WARNINGS | command output, 04:01–04:03 | `.next`/`cdk.out` are ignored build output |
| QA-03 | cross-tenant caller | RLS no-context, malformed, A-to-B access | existing PostgreSQL integration tests | zero rows / denial | test code covers three cases, but all three skipped because `CHIBBO_TEST_DATABASE_URL` is unset in this QA process | UNVERIFIED | `packages/db/src/rls.integration.test.ts`; `pnpm test` | n/a |
| QA-04 | forged applicant | draft capability tamper/mismatch/replay boundary | source + tests | malformed/replay is rejected | signature tamper is unit-tested; no runtime/API replay test exists | PARTIAL | `packages/domain/src/index.test.ts`; `apps/platform/app/lib/runtime.ts:23-27` | n/a |
| QA-05 | malicious upload | S3 contract and version pinning | storage test + static inspection | exact key/KMS/intent/version constraints | policy constrains key/type/KMS/intent and finalizer pins `HeadObject`/`GetObject` to supplied version; no real S3 integration test | PARTIAL | `packages/storage/src/index.ts:5-15,21-27`; storage unit tests | n/a |
| QA-06 | event reader | instance event-source policy | contracts/audit tests + static inspection | source maps to one permitted instance | all 13 sources have exactly one policy entry; mapping separates recruitment service/platform, internal HR, asset management, and legal corporation | PASS (static) | `packages/contracts/src/index.ts:13-27`; `events.test.ts`; `audit` tests | n/a |
| QA-07 | deployment actor | CloudTrail, S3, VPC, and IAM isolation | CDK tests/synth + static inspection | Chibbo-only constrained resources | resume-only data trail disables management events and selects only resume bucket; private RDS/S3 block public access; current tests pass. Real AWS policy simulation/deploy not run. | PARTIAL | `infra/lib/platform-stack.ts:44-65,80-112`; infra test; synth | no AWS write |
| QA-08 | missing-config operator | fail-closed configuration | `node scripts/deployment-gate.mjs` without inputs | invalid/missing configuration rejects safely | rejected immediately for all six required deployment inputs, before any AWS call | PASS | `scripts/deployment-gate.mjs:4-10`; command output | n/a |
| QA-09 | workflow attacker | deployment workflow safeguards | static workflow inspection | main/environment/OIDC/gate present | workflow uses `workflow_dispatch`, main-ref condition, protected environment, OIDC id-token, prerequisite gate, expand migration gate, and smoke check | PASS (static) | `.github/workflows/deploy.yml:4-93` | no GitHub execution |
| QA-10 | test-system attacker | dirty worktree, stale state, injection, hung/flaky/misleading success | status checks, rerun, bounded build observation | QA does not alter unrelated work or misreport | repository was already entirely untracked; no unrelated file was modified. Unit suite reran cleanly. Initial chained build exceeded 30s output window but process was observed to finish; a fresh `pnpm build` then exited 0. No product prompt-processing surface exists, so injection is not applicable. | PASS WITH LIMITS | git status, process check, second test/build output | report only |

## Commands run

- `[0] pnpm test` — 13 selected tests passed; 3 database RLS tests skipped because `CHIBBO_TEST_DATABASE_URL` was unset.
- `[0] pnpm test` (rerun) — same result; no flake observed in the selected suites.
- `[0] pnpm lint` and `[0] pnpm typecheck` — workspace TypeScript checks passed.
- `[0] pnpm build` — production Next build passed. It warns that `/Users/6kiity/package-lock.json` makes Next infer the workspace root incorrectly, and that baseline browser mapping data is old.
- `[0] pnpm infra:synth` — CDK synthesized both stacks; warnings: Node 24 is not a tested CDK runtime and ECS minHealthyPercent defaults to 50%.
- `[1] pnpm --filter @chibbo/platform test`, `@chibbo/auth test`, `@chibbo/config test`, `@chibbo/rate-limit test` — each has no test files. The root `pnpm test` does not run these package scripts.
- `[expected nonzero] node scripts/deployment-gate.mjs` without deployment inputs — failed closed before AWS access.

## Failures found

1. **High — RLS deletion request is likely nonfunctional.** `applications` uses FORCE RLS with a tenant-context policy (`database/migrations/0001_chibbo_schema.sql:37,43`). The SECURITY DEFINER `consume_deletion_request` function reads it without setting `app.company_id` (`database/migrations/0002_public_and_admin_functions.sql:21`). Under FORCE RLS this should yield no row, making a valid deletion request indistinguishable from an invalid one. Actual DB verification is blocked by the missing isolated test DB connection value.
2. **High — database runtime-role bootstrap is not reproducible from IaC/migrations.** The stack creates the generated RDS `chibbo_owner` credential (`infra/lib/platform-stack.ts:72-74`), while migrations assume pre-existing `chibbo_owner`, `chibbo_migrator`, and `chibbo_app`. No bootstrap artifact demonstrates that ECS's `DATABASE_URL` authenticates as the RLS-constrained `chibbo_app` role.
3. **High — no executable application, auth, config, or rate-limit tests.** The public API routes and staff authorization logic have no tests. `packages/rate-limit` is unused outside its own source (`rg` inventory), so the documented upload/submit quotas are not enforced.
4. **Medium — no actual Entra callback/session issuance or UI integration test.** The status mutation route has session lookup code, but no OIDC callback exists in the route surface and staff/admin pages do not exercise the service APIs. This cannot prove a customer A-to-B 404 behavior end to end.
5. **Medium — CloudFormation execution policy retains `Resource: "*"` for create actions** (`infra/lib/platform-stack.ts:105`). Required Chibbo tags reduce the blast radius but do not provide full ARN-level isolation; IAM simulator evidence is missing.

## Fixes applied

None by this independent QA agent.

During the QA window, parallel implementation work corrected two earlier observations before final review: ECS now receives the resume bucket/KMS configuration (`infra/lib/platform-stack.ts:91`), and workforce permission sets are resource-scoped (`infra/lib/workforce-stack.ts:36-40`). They require a final test rerun after implementation stabilizes.

## Cleanup and rollback

- No product, infrastructure, credential, external-system, or database-schema files were edited by this QA stage.
- The only QA-stage write is this report.
- No temporary harness, background service, AWS resource, or credential was created.
- The repository was already dirty/untracked before QA and remains so; no files were removed or reset.

## Residual risks

- RLS and cross-tenant behavior require a fresh run with the authorized isolated `CHIBBO_TEST_DATABASE_URL`; they were not exercised in this QA process.
- Actual S3 CORS/presigned POST/version behavior, Entra OIDC/B2B membership, GitHub OIDC claims, IAM Identity Center accounts, DNS/ACM, CloudTrail delivery, and AWS IAM simulation remain external preflight/E2E gates.
- This QA gate is **STOPPED / not passed** until the high findings are fixed and covered by executable tests.

## Evidence

- Source evidence references are in the scenario matrix and failure list.
- Baseline outputs were captured in the executing task transcript at 04:00–04:03 Korea time.
- The second `pnpm test` run produced 13 passing tests and 3 skipped DB tests; the fresh `pnpm build` generated all public/staff/API routes successfully.

---

## Re-run addendum — current source only

### Fresh evidence

- `CHIBBO_TEST_DATABASE_URL=postgresql:///chibbo_qa_rls_20261001_0340 pnpm test` completed with **26 passed, 0 skipped**. This includes public draft creation, no-context/malformed/A-to-B RLS denial, deletion first-use/replay rejection, and PostgreSQL rate-window tests.
- A direct catalog check confirms the recreated DB has 2 companies, 3 jobs, the five required security functions, FORCE RLS on the six tenant tables, and `rolbypassrls = false` for `chibbo_owner`, `chibbo_migrator`, and `chibbo_app`.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm infra:synth` exit successfully. Build/synth warnings are non-blocking: Next detects a parent lockfile, CDK is running under Node 24 rather than its tested Node release, and ECS uses its default 50% minimum healthy percentage.
- Source inspection confirms real OIDC protocol handling rather than a mock: authorization-code exchange with PKCE, nonce, issuer/audience checks, and JWKS verification in `packages/auth/src/index.ts:13-21`; actual Entra sign-in remains an external E2E boundary.
- Event scope routing, S3 version/presigned-post constraints, resume bucket/KMS environment injection, dedicated resume-only CloudTrail data event selector, and no-wildcard workforce permission-set test all pass at unit/static level.

### Current finding — High

The rollback-only staff-session probe first confirmed a tenant-A staff function cannot read a tenant-B application. It then attempted a `chibbo.create_staff_session` call and failed with:

`ERROR: column reference "role" is ambiguous`

The cause is the unqualified `role` in the `ORDER BY` inside `create_staff_session`; the function's `RETURNS TABLE(... role ...)` creates a same-named PL/pgSQL output variable. The source is [0003_sessions_rate_limits_and_staff_functions.sql](/Users/6kiity/Documents/virtual_chibbo/database/migrations/0003_sessions_rate_limits_and_staff_functions.sql:14). The transaction rolled back, leaving no test rows. Until this forward-migration fix is applied and the DB rebuilt, no actual Entra callback can issue a `chibbo_session`; staff/admin route E2E remains blocked.

### External boundaries, correctly unverified

- Live S3 presigned POST/CORS/version promotion.
- Entra B2B sign-in and browser session cookie issuance (currently also blocked by the SQL finding).
- AWS deployment, CloudTrail delivery, IAM simulation, Identity Center invitations/MFA, DNS/ACM, and GitHub OIDC token execution.

### Re-run verdict

**ULTRAQA STOPPED:** all current runnable baseline, RLS, deletion replay, rate-limit, event-scope, S3-contract, IaC, and build checks pass; one High staff-session SQL defect prevents authentication E2E. No source or infrastructure file was changed by this QA agent; this report is the only QA-stage write.

---

## Focused final re-run — 04:23–04:24 KST

The current migration qualifies the `memberships` column as `m.role` in [0003_sessions_rate_limits_and_staff_functions.sql](/Users/6kiity/Documents/virtual_chibbo/database/migrations/0003_sessions_rate_limits_and_staff_functions.sql:19). The isolated database was recreated from `0001`–`0003` plus the synthetic seed before this check.

- `[0] CHIBBO_TEST_DATABASE_URL=postgresql:///chibbo_qa_rls_20261001_0340 pnpm test` — **26 passed, 0 failed, 0 skipped**.
- `[0] rollback-only PostgreSQL probe as chibbo_app` — after inserting a synthetic active company-manager membership, `create_staff_session` completed and `resolve_active_session` returned exactly one row. The transaction ended with `ROLLBACK`; no test state remains.

### Final verdict

**ULTRAQA COMPLETE: goal met after the focused re-run.** The previously blocking SQL ambiguity is resolved and independently exercised. Live AWS/S3, Entra B2B, GitHub OIDC, Identity Center, DNS/ACM, and deployment remain explicit external E2E/preflight boundaries; they are not represented as local-test completion.

---

## Current-source focused re-QA — 04:30 KST

### Result: PASS

- `[0] CHIBBO_TEST_DATABASE_URL=postgresql:///chibbo_qa_rls_20261001_0340 pnpm test` — **26 passed, 0 failed, 0 skipped**. The database rate-limit test calls the supported `upload-init` scope and proves first request is allowed while the same `(scope, subject_hash)` tuple is rejected with a positive retry time.
- `[0] pnpm lint && pnpm typecheck && pnpm build` — all passed; the production build includes the new staff resume route.
- `[0] rollback-only RLS audit probe as chibbo_app` — created an alpha-company public draft, set the same company context, inserted the exact `resume.downloaded` audit shape, and rolled back. This confirms the audit statement used by `downloadStaffResume` can write under FORCE RLS when wrapped in its scoped `withTenantTransaction`.

### Current code-contract review

- `downloadStaffResume` first loads the resume through `getStaffApplication`, which uses the session's company context, and inserts the audit event through a second `withTenantTransaction` carrying that same company ID. No new RLS failure path was found. Live S3 retrieval is intentionally not claimed because it requires deployed S3 credentials and a real accepted object.
- `anonymousKey` is HMAC-SHA-256 over `YYYY-MM-DD:IP`; the rate-limit table receives only that 64-character hash. No raw IP is passed to PostgreSQL (`packages/rate-limit/src/index.ts:3-10`, `apps/platform/app/lib/runtime.ts:32-36`).
- `consume_rate_limit` rejects unsupported scopes, takes `pg_advisory_xact_lock` for the exact scope/hash tuple before count-and-insert, and the test uses a supported scope (`database/migrations/0003_sessions_rate_limits_and_staff_functions.sql:38-50`, `packages/db/src/rls.integration.test.ts:89-98`). The static lock contract plus DB behavior are verified; high-concurrency load behavior is an external performance test gap, not a correctness failure.

### External-only validation gaps

- Live S3 streaming/download and audit behavior against a deployed bucket.
- Entra B2B browser sign-in, GitHub OIDC token exchange, AWS IAM simulation, Identity Center invitation/MFA, CloudTrail delivery, and production deployment.

**Final focused verdict: PASS.** No product or infrastructure source was edited; this report remains the only QA-stage write.
