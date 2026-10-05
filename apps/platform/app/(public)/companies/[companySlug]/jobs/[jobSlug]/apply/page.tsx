import Link from "next/link";
import { notFound } from "next/navigation";
import { findPublicJob } from "../../../../../../lib/jobs";
import { ApplyForm } from "./apply-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "지원서 작성" };

export default async function ApplyPage({ params }: { params: Promise<{ companySlug: string; jobSlug: string }> }) {
  const { companySlug, jobSlug } = await params;
  const job = await findPublicJob(companySlug, jobSlug);
  if (!job) notFound();
  return (
    <main>
      <div className="narrow">
        <Link href={`/companies/${companySlug}/jobs/${jobSlug}`} className="crumb">← 공고로 돌아가기</Link>
        <div className="page-head">
          <div>
            <p className="job-company">{job.companyName}</p>
            <h1>{job.title} 지원서</h1>
          </div>
        </div>
        <p className="notice" style={{ marginBottom: 20 }}>이 사이트는 실습용 데모입니다. 실제 이력서 대신 지어낸 내용의 파일만 올려 주세요.</p>
        <ApplyForm endpoint={`/api/public/jobs/${companySlug}/${jobSlug}/upload-intents`} companyName={job.companyName} />
      </div>
    </main>
  );
}
