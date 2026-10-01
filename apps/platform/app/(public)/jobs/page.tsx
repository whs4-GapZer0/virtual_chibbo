import Link from "next/link"; import { listPublicJobs } from "../../lib/jobs";
export const dynamic = "force-dynamic";
export default async function JobsPage() { const jobs = await listPublicJobs(); return <main><h1>치뽀 채용지원</h1><p className="muted">합성 데이터만 사용하는 데모 채용 공고입니다.</p>{jobs.map((job) => <article className="card" key={`${job.companySlug}/${job.slug}`}><p className="muted">{job.companyName} · {job.workType}</p><h2>{job.title}</h2><p>{job.description}</p><Link href={`/companies/${job.companySlug}/jobs/${job.slug}`}>공고 보기</Link></article>)}</main>; }
