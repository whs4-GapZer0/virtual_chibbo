import Link from "next/link";
import { notFound } from "next/navigation";
import { Monogram } from "../../../../../components/monogram";
import { deadlineLabel, formatDate } from "../../../../../lib/format";
import { findPublicJob } from "../../../../../lib/jobs";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ companySlug: string; jobSlug: string }> };

export async function generateMetadata({ params }: Params) {
  const { companySlug, jobSlug } = await params;
  const job = await findPublicJob(companySlug, jobSlug);
  return job ? { title: `${job.title} - ${job.companyName}`, description: job.description } : {};
}

function BulletSection({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return <section className="section"><h2>{title}</h2><ul className="bullets">{items.map((item) => <li key={item}>{item}</li>)}</ul></section>;
}

export default async function JobPage({ params }: Params) {
  const { companySlug, jobSlug } = await params;
  const job = await findPublicJob(companySlug, jobSlug);
  if (!job) notFound();
  const deadline = deadlineLabel(job.closesAt);
  const applyHref = `/companies/${job.companySlug}/jobs/${job.slug}/apply`;
  const facts: [string, string | null][] = [
    ["근무지", job.location], ["경력", job.careerLevel], ["고용 형태", job.workType], ["급여", job.salaryRange],
    ["모집 인원", job.headcount ? `${job.headcount}명` : null], ["소속", job.department],
    ["마감", job.closesAt ? formatDate(job.closesAt) : "채용 시 마감"]
  ];
  return (
    <main>
      <Link href="/jobs" className="crumb">← 채용공고 전체</Link>
      <div className="detail">
        <article className="panel">
          <header className="detail-head">
            <Monogram name={job.companyName} slug={job.companySlug} large />
            <div>
              <p className="job-company">{job.companyName}{job.companyIndustry ? `, ${job.companyIndustry}` : ""}</p>
              <h1>{job.title}</h1>
              {job.tags.length > 0 && <ul className="chip-row" aria-label="관련 기술과 키워드">{job.tags.map((tag) => <li className="chip" key={tag}>{tag}</li>)}</ul>}
            </div>
          </header>
          <p className="lede">{job.description}</p>
          <BulletSection title="담당 업무" items={job.responsibilities} />
          <BulletSection title="자격 요건" items={job.requirements} />
          <BulletSection title="우대 사항" items={job.preferred} />
          <BulletSection title="복리후생" items={job.company.benefits} />
          {job.hiringProcess.length > 0 && (
            <section className="section">
              <h2>전형 절차</h2>
              <ol className="steps">{job.hiringProcess.map((step) => <li key={step}>{step}</li>)}</ol>
              <p className="muted small" style={{ marginTop: 12 }}>전형 결과는 지원 시 입력한 이메일로 안내합니다.</p>
            </section>
          )}
        </article>
        <aside className="aside">
          <div className="panel">
            <span className={deadline.soon ? "deadline deadline-soon" : "deadline"}>{deadline.text}</span>
            <dl className="facts">
              {facts.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
            </dl>
            <Link href={applyHref} className="btn btn-wide">지원하기</Link>
          </div>
          {(job.company.description || job.company.tagline) && (
            <div className="panel company-card">
              <h2>{job.companyName}</h2>
              {job.company.tagline && <p style={{ color: "var(--ink)", fontWeight: 600 }}>{job.company.tagline}</p>}
              {job.company.description && <p>{job.company.description}</p>}
              <dl className="facts" style={{ marginBottom: 0 }}>
                {job.company.location && <div><dt>위치</dt><dd>{job.company.location}</dd></div>}
                {job.company.employeeScale && <div><dt>구성원</dt><dd>{job.company.employeeScale}</dd></div>}
                {job.company.foundedYear && <div><dt>설립</dt><dd>{job.company.foundedYear}년</dd></div>}
              </dl>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
