import { Pool } from "pg";
import { databaseConnectionOptions, loadConfig } from "@chibbo/config";
export type PublicJob = { companySlug: string; companyName: string; slug: string; title: string; description: string; workType: string };
let pool: Pool | undefined;
function database(): Pool { return (pool ??= new Pool({ ...databaseConnectionOptions(loadConfig()), max: 5 })); }
export async function listPublicJobs(): Promise<PublicJob[]> { const result = await database().query("SELECT company_slug AS \"companySlug\", company_name AS \"companyName\", job_slug AS slug, title, description, work_type AS \"workType\" FROM chibbo.list_published_jobs()"); return result.rows; }
export async function findPublicJob(companySlug: string, jobSlug: string): Promise<PublicJob | undefined> { const result = await database().query("SELECT company_slug AS \"companySlug\", company_name AS \"companyName\", job_slug AS slug, title, description, work_type AS \"workType\" FROM chibbo.get_published_job($1, $2)", [companySlug, jobSlug]); return result.rows[0]; }
