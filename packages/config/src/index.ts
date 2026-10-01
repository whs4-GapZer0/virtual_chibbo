import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url().optional(),
  PGHOST: z.string().min(1).optional(),
  PGPORT: z.coerce.number().int().min(1).max(65535).optional(),
  PGDATABASE: z.string().min(1).optional(),
  PGUSER: z.string().min(1).optional(),
  PGPASSWORD: z.string().min(1).optional(),
  PGSSLMODE: z.enum(["disable", "require"]).default("disable"),
  CHIBBO_STORAGE_MODE: z.enum(["local", "s3"]).default("local"),
  CHIBBO_LOCAL_STORAGE_DIR: z.string().default(".local-storage"),
  CHIBBO_RESUME_BUCKET: z.string().min(3).optional(),
  CHIBBO_RESUME_KMS_KEY_ID: z.string().min(1).optional(),
  CHIBBO_DELETION_PEPPER: z.string().min(16),
  NEXT_PUBLIC_APP_ORIGIN: z.string().url().default("http://localhost:3000"),
  ENTRA_TENANT_ID: z.string().uuid().optional(),
  ENTRA_CLIENT_ID: z.string().uuid().optional(),
  ENTRA_CLIENT_SECRET: z.string().min(1).optional()
}).superRefine((value, ctx) => {
  if (value.CHIBBO_STORAGE_MODE === "s3" && (!value.CHIBBO_RESUME_BUCKET || !value.CHIBBO_RESUME_KMS_KEY_ID)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "S3 mode requires resume bucket and KMS key" });
});
export type AppConfig = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig { return schema.parse(env); }
export function databaseConnectionString(config: AppConfig): string {
  if (config.DATABASE_URL) return config.DATABASE_URL;
  const missing = ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"].filter((key) => !config[key as keyof AppConfig]);
  if (missing.length > 0) throw new Error("database configuration is incomplete");
  return `postgresql://${encodeURIComponent(config.PGUSER!)}:${encodeURIComponent(config.PGPASSWORD!)}@${config.PGHOST!}:${config.PGPORT ?? 5432}/${encodeURIComponent(config.PGDATABASE!)}`;
}
export function databaseConnectionOptions(config: AppConfig): { connectionString: string; ssl?: { rejectUnauthorized: true } } {
  return { connectionString: databaseConnectionString(config), ...(config.PGSSLMODE === "require" ? { ssl: { rejectUnauthorized: true as const } } : {}) };
}
