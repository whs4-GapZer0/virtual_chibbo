import { AdminCompaniesClient } from "./admin-companies-client";
export const dynamic = "force-dynamic"; export default function CompaniesAdmin() { return <main><h1>고객사·담당자 관리</h1><p className="muted">플랫폼 관리자 membership이 확인된 세션만 접근할 수 있습니다.</p><AdminCompaniesClient /></main>; }
