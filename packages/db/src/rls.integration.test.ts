import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { withTenantTransaction } from "./index.js";

const databaseUrl = process.env.CHIBBO_TEST_DATABASE_URL;
const alphaCompany = "00000000-0000-4000-8000-000000000001";
const betaCompany = "00000000-0000-4000-8000-000000000002";

async function asApp<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE chibbo_app");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

describe.skipIf(!databaseUrl)("PostgreSQL RLS integration", () => {
  it("creates a public draft through the scoped function while FORCE RLS is enabled", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const result = await asApp(pool, (client) => client.query(
        "SELECT * FROM chibbo.create_public_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + interval '10 minutes')",
        ["alpha-works", "support-engineer", "테스트 지원자", "applicant@example.test", "test", "0".repeat(64), "test", randomUUID(), `TEST-${randomUUID()}`, "application/pdf"]
      ));
      expect(result.rowCount).toBe(1);
      expect(result.rows[0].company_id).toBe(alphaCompany);
    } finally {
      await pool.end();
    }
  });

  it("denies an unscoped query and hides beta rows from alpha context", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const betaDraft = await asApp(pool, (client) => client.query(
        "SELECT * FROM chibbo.create_public_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + interval '10 minutes')",
        ["beta-studio", "product-designer", "베타 지원자", "beta-applicant@example.test", "test", "1".repeat(64), "test", randomUUID(), `TEST-${randomUUID()}`, "application/pdf"]
      ));
      expect(betaDraft.rows[0].company_id).toBe(betaCompany);
      const unscoped = await asApp(pool, (client) => client.query("SELECT id FROM chibbo.applications"));
      expect(unscoped.rowCount).toBe(0);
      const foreign = await withTenantTransaction(pool, { companyId: alphaCompany, tenantId: "00000000-0000-4000-8000-000000000011", objectId: "00000000-0000-4000-8000-000000000012", role: "company-manager" }, async (client) => {
        await client.query("SET LOCAL ROLE chibbo_app");
        return client.query("SELECT id FROM chibbo.applications WHERE company_id=$1", [betaCompany]);
      });
      expect(foreign.rowCount).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("treats malformed tenant context as no context", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const rows = await asApp(pool, async (client) => {
        await client.query("SELECT set_config('app.company_id', 'not-a-uuid', true)");
        return client.query("SELECT id FROM chibbo.applications");
      });
      expect(rows.rowCount).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it("allows one deletion request then denies a replay while running as chibbo_app", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const receipt = `DELETE-${randomUUID()}`;
      await asApp(pool, (client) => client.query(
        "SELECT * FROM chibbo.create_public_draft($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + interval '10 minutes')",
        ["alpha-works", "support-engineer", "삭제 지원자", "delete@example.test", "test", "a".repeat(64), "test", randomUUID(), receipt, "application/pdf"]
      ));
      const first = await asApp(pool, (client) => client.query("SELECT chibbo.consume_deletion_request($1,$2) AS consumed", [receipt, "a".repeat(64)]));
      const second = await asApp(pool, (client) => client.query("SELECT chibbo.consume_deletion_request($1,$2) AS consumed", [receipt, "a".repeat(64)]));
      expect(first.rows[0].consumed).toBe(true);
      expect(second.rows[0].consumed).toBe(false);
    } finally { await pool.end(); }
  });

  it("enforces a shared PostgreSQL rate-limit window", async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const key = `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`; const scope = "upload-init";
      const first = await asApp(pool, (client) => client.query("SELECT * FROM chibbo.consume_rate_limit($1,$2,$3,$4)", [scope, key, 60, 1]));
      const second = await asApp(pool, (client) => client.query("SELECT * FROM chibbo.consume_rate_limit($1,$2,$3,$4)", [scope, key, 60, 1]));
      expect(first.rows[0].allowed).toBe(true);
      expect(second.rows[0].allowed).toBe(false);
      expect(Number(second.rows[0].retry_after_seconds)).toBeGreaterThan(0);
    } finally { await pool.end(); }
  });
});
