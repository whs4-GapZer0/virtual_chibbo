import { StaffApplicationsClient } from "./staff-applications-client";
export const dynamic = "force-dynamic"; export default function StaffApplications() { return <main><h1>고객사 지원자 관리</h1><p className="muted">지원자 목록은 로그인한 고객사 담당자의 소속 범위에서만 표시됩니다.</p><StaffApplicationsClient /></main>; }
