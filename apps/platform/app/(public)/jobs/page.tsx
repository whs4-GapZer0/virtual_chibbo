import { listPublicJobs } from "../../lib/jobs";
import { JobBoard } from "./job-board";

export const dynamic = "force-dynamic";
export const metadata = { title: "채용공고" };

export default async function JobsPage() {
  const jobs = await listPublicJobs();
  const companies = new Set(jobs.map((job) => job.companySlug)).size;
  return (
    <main>
      <div className="board-head">
        <h1>지금 지원할 수 있는 공고 {jobs.length}건</h1>
        <p className="muted">{companies}개 기업이 치뽀에서 함께 일할 사람을 찾고 있습니다. 직무나 회사 이름으로 찾아보세요.</p>
      </div>
      <JobBoard jobs={jobs} now={new Date().toISOString()} />
    </main>
  );
}
