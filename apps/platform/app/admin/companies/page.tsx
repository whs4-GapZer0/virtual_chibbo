import { AdminCompaniesClient } from "./admin-companies-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "고객사·담당자 관리" };

export default function CompaniesAdmin() {
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>고객사·담당자 관리</h1>
          <p className="muted">플랫폼 관리자만 사용할 수 있습니다.</p>
        </div>
      </div>
      <AdminCompaniesClient />
    </main>
  );
}
