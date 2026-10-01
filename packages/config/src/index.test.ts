import { describe, expect, it } from "vitest";
import { databaseConnectionString, loadConfig } from "./index.js";
describe("configuration", () => {
  it("fails closed without a deletion pepper", () => expect(() => loadConfig({ NEXT_PUBLIC_APP_ORIGIN: "http://localhost:3000" })).toThrow());
  it("rejects incomplete S3 configuration", () => expect(() => loadConfig({ CHIBBO_DELETION_PEPPER: "a".repeat(16), CHIBBO_STORAGE_MODE: "s3" })).toThrow());
  it("builds a database URL from a password supplied separately from the endpoint", () => {
    const config = loadConfig({ CHIBBO_DELETION_PEPPER: "a".repeat(16), PGHOST: "db.internal", PGDATABASE: "chibbo", PGUSER: "chibbo_app", PGPASSWORD: "p@ss word", PGPORT: "5433" });
    expect(databaseConnectionString(config)).toBe("postgresql://chibbo_app:p%40ss%20word@db.internal:5433/chibbo");
  });
});
