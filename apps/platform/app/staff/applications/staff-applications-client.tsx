"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { STATUS_LABEL, formatDateTime, type ApplicationStatus } from "../../lib/format";

type Application = {
  id: string; receipt_number: string; applicant_name: string; job_title: string; status: ApplicationStatus; row_version: number; created_at: string;
  applicant_email_masked?: string | null; applicant_phone_masked?: string | null; career_years?: number | null; education?: string | null; current_company?: string | null;
};
type Decision = "reviewing" | "accepted" | "rejected";
const PIPELINE: ApplicationStatus[] = ["submitted", "reviewing", "accepted", "rejected"];

export function StaffApplicationsClient() {
  const [items, setItems] = useState<Application[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<ApplicationStatus | null>(null);
  const [job, setJob] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/staff/applications", { cache: "no-store" });
    setSignedOut(!response.ok);
    setItems(response.ok ? await response.json() : []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function change(application: Application, next: Decision) {
    setMessage("");
    const response = await fetch(`/api/staff/applications/${application.id}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next, rowVersion: application.row_version }) });
    if (!response.ok) setMessage(response.status === 409 ? "다른 담당자가 먼저 상태를 바꿨습니다. 최신 목록을 다시 불러왔습니다." : "상태를 바꾸지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
    await load();
  }

  const jobs = useMemo(() => [...new Set((items ?? []).map((item) => item.job_title))].sort(), [items]);
  const scoped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (items ?? []).filter((item) => (!job || item.job_title === job) && (!needle || item.applicant_name.toLowerCase().includes(needle) || item.receipt_number.toLowerCase().includes(needle)));
  }, [items, job, query]);
  const visible = status ? scoped.filter((item) => item.status === status) : scoped;

  if (items === null) return <p className="muted">지원자 목록을 불러오는 중입니다.</p>;
  if (signedOut) {
    return (
      <section className="panel empty">
        <strong>기업 담당자 로그인이 필요합니다</strong>
        <p>회사 계정(Microsoft Entra ID)으로 로그인하면 소속 회사의 지원자를 볼 수 있습니다.</p>
        <p style={{ marginTop: 20 }}><a className="btn" href="/api/auth/login">회사 계정으로 로그인</a></p>
      </section>
    );
  }

  return (
    <>
      <div className="pipeline" role="group" aria-label="전형 단계별 지원자 수">
        {PIPELINE.map((stage) => (
          <button key={stage} type="button" aria-pressed={status === stage} onClick={() => setStatus(status === stage ? null : stage)}>
            <span className="count">{scoped.filter((item) => item.status === stage).length}</span>
            <span className="name">{STATUS_LABEL[stage]}</span>
          </button>
        ))}
      </div>
      <section className="panel">
        <div className="toolbar">
          <div className="field">
            <label htmlFor="applicant-search" className="sr-only">지원자 검색</label>
            <input id="applicant-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="이름 또는 접수번호" />
          </div>
          <div className="field">
            <label htmlFor="job-filter" className="sr-only">공고 선택</label>
            <select id="job-filter" value={job} onChange={(event) => setJob(event.target.value)} style={{ height: 42 }}>
              <option value="">모든 공고</option>
              {jobs.map((title) => <option key={title} value={title}>{title}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-quiet btn-s" onClick={() => void load()}>새로 고침</button>
        </div>
        {message && <p className="notice notice-error" role="alert" style={{ marginBottom: 16 }}>{message}</p>}
        {visible.length === 0 ? (
          <div className="empty"><strong>{items.length === 0 ? "아직 접수된 지원서가 없습니다" : "조건에 맞는 지원자가 없습니다"}</strong>{items.length > 0 && <p>검색어나 단계 선택을 바꿔 보세요.</p>}</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">지원자</th><th scope="col">지원 공고</th><th scope="col">경력</th><th scope="col">연락처</th><th scope="col">접수</th><th scope="col">상태</th><th scope="col">처리</th></tr></thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <td><div className="person"><a href={`/staff/applications/${item.id}`}>{item.applicant_name}</a><span>{item.receipt_number}</span></div></td>
                    <td>{item.job_title}</td>
                    <td>{item.career_years == null ? "-" : item.career_years === 0 ? "신입" : `${item.career_years}년`}{item.current_company && <div className="cell-sub">{item.current_company}</div>}</td>
                    <td>{item.applicant_phone_masked ?? "-"}<div className="cell-sub">{item.applicant_email_masked}</div></td>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(item.created_at)}</td>
                    <td><span className={`status status-${item.status}`}>{STATUS_LABEL[item.status]}</span></td>
                    <td>
                      <div className="actions">
                        {item.status === "submitted" && <button type="button" className="btn btn-s" onClick={() => void change(item, "reviewing")}>검토 시작</button>}
                        {item.status === "reviewing" && <><button type="button" className="btn btn-s" onClick={() => void change(item, "accepted")}>합격</button><button type="button" className="btn btn-danger btn-s" onClick={() => void change(item, "rejected")}>불합격</button></>}
                        {(item.status === "accepted" || item.status === "rejected") && <span className="cell-sub">처리 완료</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="muted small" style={{ marginTop: 12 }}>목록의 연락처는 일부를 가려서 보여 줍니다. 전체 정보는 지원자 상세에서 확인하세요.</p>
    </>
  );
}
