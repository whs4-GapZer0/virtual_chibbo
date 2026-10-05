"use client";
import { FormEvent, useEffect, useState } from "react";

type Company = { id: string; name: string; slug: string; status: string };
type Role = "company-manager" | "platform-admin";
type Membership = { id: string; entra_tenant_id: string; entra_object_id: string; role: Role; active: boolean; membership_version: number };
const ROLE_LABEL: Record<Role, string> = { "company-manager": "고객사 채용 담당자", "platform-admin": "플랫폼 관리자" };

export function AdminCompaniesClient() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [selected, setSelected] = useState<Company | null>(null);
  const [members, setMembers] = useState<Membership[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const loadMembers = async (company: Company) => {
    setSelected(company); setMessage(null);
    const response = await fetch(`/api/admin/companies/${company.id}/memberships`, { cache: "no-store" });
    setMembers(response.ok ? await response.json() : []);
  };
  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/admin/companies", { cache: "no-store" });
      setSignedOut(!response.ok);
      setCompanies(response.ok ? await response.json() : []);
    })();
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch(`/api/admin/companies/${selected.id}/memberships`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId: data.get("tenantId"), objectId: data.get("objectId"), role: data.get("role"), active: data.get("active") === "on" }) });
    if (!response.ok) { setMessage({ kind: "error", text: "담당자를 저장하지 못했습니다. ID 형식을 확인해 주세요." }); return; }
    await loadMembers(selected);
    setMessage({ kind: "ok", text: "담당자를 저장했습니다. 이 계정의 기존 로그인은 모두 해제되었습니다." });
    form.reset();
  }

  if (companies === null) return <p className="muted">고객사를 불러오는 중입니다.</p>;
  if (signedOut) {
    return (
      <section className="panel empty">
        <strong>플랫폼 관리자 로그인이 필요합니다</strong>
        <p>관리자 권한이 있는 회사 계정으로 로그인해 주세요.</p>
        <p style={{ marginTop: 20 }}><a className="btn" href="/api/auth/login">회사 계정으로 로그인</a></p>
      </section>
    );
  }

  return (
    <div className="columns">
      <section className="panel">
        <h2 style={{ marginBottom: 14 }}>고객사 {companies.length}곳</h2>
        <ul className="select-list">
          {companies.map((company) => (
            <li key={company.id}>
              <button type="button" aria-pressed={selected?.id === company.id} onClick={() => void loadMembers(company)}>
                <span>{company.name}<span className="cell-sub" style={{ display: "block", fontWeight: 400 }}>{company.slug}</span></span>
                <span className={company.status === "active" ? "status status-accepted" : "status status-rejected"}>{company.status === "active" ? "운영 중" : "중지"}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {selected ? (
        <div>
          <section className="panel">
            <h2 style={{ marginBottom: 14 }}>{selected.name} 담당자</h2>
            {members.length === 0 ? <p className="muted">등록된 담당자가 없습니다. 아래에서 첫 담당자를 추가하세요.</p> : (
              <div className="table-wrap" style={{ marginBottom: -28 }}>
                <table>
                  <thead><tr><th scope="col">Entra 테넌트 ID</th><th scope="col">Entra 사용자 ID</th><th scope="col">역할</th><th scope="col">상태</th></tr></thead>
                  <tbody>{members.map((member) => <tr key={member.id}><td className="mono-id">{member.entra_tenant_id}</td><td className="mono-id">{member.entra_object_id}</td><td>{ROLE_LABEL[member.role]}</td><td><span className={member.active ? "status status-accepted" : "status status-rejected"}>{member.active ? "사용 중" : "중지"}</span></td></tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
          <section className="panel">
            <h2>담당자 추가 또는 변경</h2>
            <p className="muted small" style={{ margin: "6px 0 18px" }}>이미 등록된 계정의 ID를 입력하면 역할과 상태가 바뀝니다. 저장하면 해당 계정의 로그인이 해제됩니다.</p>
            <form onSubmit={save} className="form-grid">
              <div className="form-pair">
                <div className="field"><label htmlFor="tenantId">Entra 테넌트 ID</label><input id="tenantId" name="tenantId" type="text" required pattern="[0-9a-fA-F\-]{36}" placeholder="00000000-0000-0000-0000-000000000000" /></div>
                <div className="field"><label htmlFor="objectId">Entra 사용자 ID</label><input id="objectId" name="objectId" type="text" required pattern="[0-9a-fA-F\-]{36}" placeholder="00000000-0000-0000-0000-000000000000" /></div>
              </div>
              <div className="field"><label htmlFor="role">역할</label><select id="role" name="role" defaultValue="company-manager"><option value="company-manager">{ROLE_LABEL["company-manager"]}</option><option value="platform-admin">{ROLE_LABEL["platform-admin"]}</option></select></div>
              <label className="check"><input name="active" type="checkbox" defaultChecked /><span>이 계정을 사용 상태로 둡니다</span></label>
              {message && <p className={message.kind === "ok" ? "notice notice-ok" : "notice notice-error"} role="status">{message.text}</p>}
              <div><button type="submit" className="btn">담당자 저장</button></div>
            </form>
          </section>
        </div>
      ) : <section className="panel empty"><strong>고객사를 선택하세요</strong><p>왼쪽 목록에서 고객사를 고르면 담당자를 관리할 수 있습니다.</p></section>}
    </div>
  );
}
