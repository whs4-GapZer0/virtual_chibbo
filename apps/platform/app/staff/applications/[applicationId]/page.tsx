import { ApplicationDetailClient } from "./application-detail-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "지원자 상세" };

export default async function ApplicationDetail({ params }: { params: Promise<{ applicationId: string }> }) {
  return (
    <main>
      <a href="/staff/applications" className="crumb">← 지원자 목록</a>
      <ApplicationDetailClient applicationId={(await params).applicationId} />
    </main>
  );
}
