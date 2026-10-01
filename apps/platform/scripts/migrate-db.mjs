import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const databaseDir = join(repositoryRoot, "database");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function connection(user, password) {
  return {
    host: required("CHIBBO_DB_ADMIN_HOST"),
    port: Number(process.env.CHIBBO_DB_ADMIN_PORT ?? "5432"),
    database: required("CHIBBO_DATABASE_NAME"),
    user,
    password,
    application_name: "chibbo-migrator"
  };
}

async function runSql(client, path) {
  await client.query(await readFile(path, "utf8"));
}

async function asOwner(client, operation) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE chibbo_owner");
    const result = await operation();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function migrationRecorded(client, name) {
  return asOwner(client, async () => {
    const result = await client.query("SELECT 1 FROM chibbo.schema_migrations WHERE name=$1", [name]);
    return result.rowCount === 1;
  });
}

async function recordMigration(client, name) {
  await asOwner(client, () => client.query("INSERT INTO chibbo.schema_migrations(name) VALUES($1)", [name]));
}

async function main() {
  const adminUser = required("CHIBBO_DB_ADMIN_USER");
  const adminPassword = required("CHIBBO_DB_ADMIN_PASSWORD");
  const migratorPassword = required("CHIBBO_MIGRATOR_DB_PASSWORD");
  const appPassword = required("CHIBBO_APP_DB_PASSWORD");
  const admin = new Client(connection(adminUser, adminPassword));
  await admin.connect();
  try {
    await runSql(admin, join(databaseDir, "bootstrap-roles.sql"));
    await admin.query(`ALTER ROLE chibbo_migrator PASSWORD ${quoteLiteral(migratorPassword)}`);
    await admin.query(`ALTER ROLE chibbo_app PASSWORD ${quoteLiteral(appPassword)}`);
    await admin.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  } finally {
    await admin.end();
  }

  const migrator = new Client(connection("chibbo_migrator", migratorPassword));
  await migrator.connect();
  try {
    const migrations = (await readdir(join(databaseDir, "migrations"))).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    const initial = migrations.shift();
    if (!initial) throw new Error("initial migration missing");
    const migrationTable = await migrator.query("SELECT to_regclass('chibbo.schema_migrations') AS table_name");
    if (!migrationTable.rows[0]?.table_name) {
      await runSql(migrator, join(databaseDir, "migrations", initial));
      await asOwner(migrator, async () => {
        await migrator.query("CREATE TABLE chibbo.schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
        await migrator.query("INSERT INTO chibbo.schema_migrations(name) VALUES($1)", [initial]);
      });
    } else if (!(await migrationRecorded(migrator, initial))) {
      throw new Error("initial schema exists without migration record");
    }
    for (const migration of migrations) {
      if (await migrationRecorded(migrator, migration)) continue;
      await runSql(migrator, join(databaseDir, "migrations", migration));
      await recordMigration(migrator, migration);
    }
    if (process.env.CHIBBO_SEED_SYNTHETIC === "true") await runSql(migrator, join(databaseDir, "seed.synthetic.sql"));
  } finally {
    await migrator.end();
  }
  process.stdout.write("Chibbo database migration completed.\n");
}

main().catch((error) => {
  process.stderr.write(`Chibbo database migration failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
