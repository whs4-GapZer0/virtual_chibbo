import { Pool } from "pg";
import { databaseConnectionOptions, loadConfig } from "@chibbo/config";

export type PublicJob = {
  companySlug: string; companyName: string; companyIndustry: string | null;
  slug: string; title: string; description: string; workType: string;
  department: string | null; location: string | null; careerLevel: string | null; salaryRange: string | null;
  tags: string[]; closesAt: string | null; publishedAt: string | null;
};
export type PublicJobDetail = PublicJob & {
  headcount: number | null; responsibilities: string[]; requirements: string[]; preferred: string[]; hiringProcess: string[];
  company: { tagline: string | null; description: string | null; location: string | null; employeeScale: string | null; foundedYear: number | null; homepageUrl: string | null; benefits: string[] };
};

let pool: Pool | undefined;
function database(): Pool { return (pool ??= new Pool({ ...databaseConnectionOptions(loadConfig()), max: 5 })); }

type Row = Record<string, unknown>;
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null);
const list = (value: unknown) => (Array.isArray(value) ? (value as string[]) : []);
const text = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);

function toJob(row: Row): PublicJob {
  return {
    companySlug: row.company_slug as string, companyName: row.company_name as string, companyIndustry: text(row.company_industry),
    slug: row.job_slug as string, title: row.title as string, description: row.description as string, workType: row.work_type as string,
    department: text(row.department), location: text(row.location), careerLevel: text(row.career_level), salaryRange: text(row.salary_range),
    tags: list(row.tags), closesAt: iso(row.closes_at), publishedAt: iso(row.published_at)
  };
}

export async function listPublicJobs(): Promise<PublicJob[]> {
  const result = await database().query("SELECT * FROM chibbo.list_published_jobs()");
  return result.rows.map(toJob);
}

export async function findPublicJob(companySlug: string, jobSlug: string): Promise<PublicJobDetail | undefined> {
  const result = await database().query("SELECT * FROM chibbo.get_published_job($1, $2)", [companySlug, jobSlug]);
  const row: Row | undefined = result.rows[0];
  if (!row) return undefined;
  return {
    ...toJob(row),
    headcount: typeof row.headcount === "number" ? row.headcount : null,
    responsibilities: list(row.responsibilities), requirements: list(row.requirements), preferred: list(row.preferred), hiringProcess: list(row.hiring_process),
    company: { tagline: text(row.company_tagline), description: text(row.company_description), location: text(row.company_location), employeeScale: text(row.company_employee_scale), foundedYear: typeof row.company_founded_year === "number" ? row.company_founded_year : null, homepageUrl: text(row.company_homepage_url), benefits: list(row.company_benefits) }
  };
}
