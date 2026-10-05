import { StaffApplicationsClient } from "./staff-applications-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "지원자 관리" };

export default function StaffApplications() {
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>지원자 관리</h1>
          <p className="muted">로그인한 담당자의 소속 회사 지원자만 표시됩니다.</p>
        </div>
      </div>
      <StaffApplicationsClient />
    </main>
  );
}
