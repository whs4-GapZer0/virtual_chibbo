"use client";
import { useCallback, useEffect, useState } from "react";
import { STATUS_LABEL, formatDate, formatDateTime, type ApplicationStatus } from "../../../lib/format";

type Detail = {
  receipt_number: string; applicant_name: string; applicant_email: string; job_title: string; status: ApplicationStatus; row_version: number; created_at: string; resume: unknown;
  applicant_phone?: string | null; applicant_birth_date?: string | null; applicant_address?: string | null; education?: string | null; career_years?: number | null; current_company?: string | null; career_summary?: string | null;
  privacy_notice_version?: string | null; notice_acknowledged_at?: string | null;
};
type Decision = "reviewing" | "accepted" | "rejected";

export function ApplicationDetailClient({ applicationId }: { applicationId: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/staff/applications/${applicationId}`, { cache: "no-store" });
    if (!response.ok) { setMissing(true); return; }
    setDetail(await response.json());
  }, [applicationId]);
  useEffect(() => { void load(); }, [load]);

  async function change(next: Decision) {
    if (!detail) return;
    setMessage("");
    const response = await fetch(`/api/staff/applications/${applicationId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next, rowVersion: detail.row_version }) });
    if (!response.ok) setMessage(response.status === 409 ? "다른 담당자가 먼저 상태를 바꿨습니다. 최신 내용을 다시 불러왔습니다." : "상태를 바꾸지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    await load();
  }

  if (missing) {
    return (
      <section className="panel empty">
        <strong>지원서를 열 수 없습니다</strong>
        <p>로그인이 만료되었거나, 소속 회사의 지원서가 아닙니다.</p>
        <p style={{ marginTop: 20 }}><a className="btn" href="/api/auth/login">회사 계정으로 로그인</a></p>
      </section>
    );
  }
  if (!detail) return <p className="muted">지원서를 불러오는 중입니다.</p>;

  const career = detail.career_years == null ? null : detail.career_years === 0 ? "신입" : `${detail.career_years}년`;
  return (
    <div className="profile">
      <div>
        <section className="panel">
          <div className="profile-head">
            <span className="monogram monogram-l" aria-hidden="true">{detail.applicant_name.slice(0, 1)}</span>
            <div>
              <h2>{detail.applicant_name}</h2>
              <p className="muted">{detail.job_title} 지원</p>
            </div>
          </div>
          <div className="section">
            <h2>인적 사항</h2>
            <dl className="data">
              <dt>이메일</dt><dd>{detail.applicant_email}</dd>
              <dt>휴대전화</dt><dd>{detail.applicant_phone ?? "-"}</dd>
              <dt>생년월일</dt><dd>{detail.applicant_birth_date ? formatDate(detail.applicant_birth_date) : "-"}</dd>
              <dt>주소</dt><dd>{detail.applicant_address ?? "-"}</dd>
            </dl>
          </div>
          <div className="section">
            <h2>학력과 경력</h2>
            <dl className="data">
              <dt>최종 학력</dt><dd>{detail.education ?? "-"}</dd>
              <dt>총 경력</dt><dd>{career ?? "-"}</dd>
              <dt>최근 직장</dt><dd>{detail.current_company ?? "-"}</dd>
              <dt>경력 요약</dt><dd style={{ fontWeight: 400 }}>{detail.career_summary ?? "-"}</dd>
            </dl>
          </div>
        </section>
      </div>
      <aside className="stack">
        <section className="panel">
          <span className={`status status-${detail.status}`}>{STATUS_LABEL[detail.status]}</span>
          <dl className="facts">
            <div><dt>접수번호</dt><dd className="mono-id">{detail.receipt_number}</dd></div>
            <div><dt>접수 시각</dt><dd>{formatDateTime(detail.created_at)}</dd></div>
            <div><dt>동의 버전</dt><dd>{detail.privacy_notice_version ?? "-"}</dd></div>
          </dl>
          {message && <p className="notice notice-error" role="alert" style={{ marginBottom: 12 }}>{message}</p>}
          <div className="stack">
            {detail.status === "submitted" && <button type="button" className="btn btn-wide" onClick={() => void change("reviewing")}>검토 시작</button>}
            {detail.status === "reviewing" && <><button type="button" className="btn btn-wide" onClick={() => void change("accepted")}>합격 처리</button><button type="button" className="btn btn-danger btn-wide" onClick={() => void change("rejected")}>불합격 처리</button></>}
            {detail.resume
              ? <a className="btn btn-quiet btn-wide" href={`/api/staff/applications/${applicationId}/resume`}>이력서 내려받기</a>
              : <p className="muted small">검증을 마친 이력서 파일이 없습니다.</p>}
          </div>
        </section>
        <p className="muted small">이력서를 내려받으면 감사 기록에 남습니다. 지원자 정보는 채용 목적으로만 사용하세요.</p>
      </aside>
    </div>
  );
}
