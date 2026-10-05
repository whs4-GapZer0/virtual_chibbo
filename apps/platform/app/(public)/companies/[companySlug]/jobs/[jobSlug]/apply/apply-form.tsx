"use client";
import Link from "next/link";
import { useState } from "react";

const PRIVACY_NOTICE_VERSION = "2026-10-synthetic";

class SubmitError extends Error {}

async function submitApplication(endpoint: string, form: HTMLFormElement): Promise<string> {
  const data = new FormData(form);
  const file = data.get("resume");
  if (!(file instanceof File) || file.size === 0) throw new SubmitError("이력서 파일을 선택해 주세요.");
  if (file.size > 5 * 1024 * 1024) throw new SubmitError("이력서 파일이 5MB를 넘습니다. 더 작은 파일로 다시 선택해 주세요.");
  const phone = String(data.get("applicantPhone") ?? "").trim();
  const init = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      applicantName: data.get("applicantName"), applicantEmail: data.get("applicantEmail"), ...(phone ? { applicantPhone: phone } : {}),
      privacyNoticeVersion: PRIVACY_NOTICE_VERSION, privacyNoticeAcknowledged: data.get("privacyNoticeAcknowledged") === "on",
      filename: file.name, mediaType: file.type, sizeBytes: file.size
    })
  });
  if (init.status === 429) throw new SubmitError("요청이 많아 잠시 접수가 제한되었습니다. 몇 분 뒤 다시 제출해 주세요.");
  if (init.status === 404) throw new SubmitError("마감되었거나 내려간 공고입니다.");
  if (!init.ok) throw new SubmitError("입력 내용을 확인해 주세요. 이력서는 PDF 또는 DOCX 파일만 받습니다.");
  const draft = await init.json();
  if (draft.upload.adapter !== "s3-presigned-post") throw new SubmitError("이 환경에서는 파일 저장소가 연결되어 있지 않아 접수할 수 없습니다.");
  const post = new FormData();
  for (const [key, value] of Object.entries(draft.upload.fields)) post.append(key, value as string);
  post.append("file", file);
  const uploaded = await fetch(draft.upload.url, { method: "POST", body: post });
  const versionId = uploaded.headers.get("x-amz-version-id");
  if (!uploaded.ok || !versionId) throw new SubmitError("이력서를 올리지 못했습니다. 다시 제출해 주세요.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((n) => n.toString(16).padStart(2, "0")).join("");
  const finalized = await fetch(`/api/public/upload-intents/${draft.intentId}/finalize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ objectVersionId: versionId, sha256: hash }) });
  if (!finalized.ok) throw new SubmitError("이력서 파일을 확인하지 못했습니다. 파일이 손상되지 않았는지 확인한 뒤 다시 제출해 주세요.");
  return draft.receipt as string;
}

export function ApplyForm({ endpoint, companyName }: { endpoint: string; companyName: string }) {
  const [receipt, setReceipt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (receipt) {
    return (
      <section className="panel receipt" role="status">
        <h2>지원서를 제출했습니다</h2>
        <p className="code">{receipt}</p>
        <p className="muted">접수번호입니다. 전형 문의나 지원 철회에 필요하니 보관해 주세요.<br />결과는 입력한 이메일로 안내합니다.</p>
        <p style={{ marginTop: 24 }}><Link href="/jobs" className="btn btn-quiet">다른 공고 보기</Link></p>
      </section>
    );
  }

  return (
    <form className="panel form-grid" onSubmit={(event) => {
      event.preventDefault();
      setBusy(true); setError("");
      submitApplication(endpoint, event.currentTarget)
        .then(setReceipt)
        .catch((reason) => setError(reason instanceof SubmitError ? reason.message : "지원서를 제출하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 제출해 주세요."))
        .finally(() => setBusy(false));
    }}>
      <div className="field">
        <label htmlFor="name">이름</label>
        <input id="name" name="applicantName" type="text" required maxLength={120} autoComplete="name" />
      </div>
      <div className="form-pair">
        <div className="field">
          <label htmlFor="email">이메일</label>
          <input id="email" name="applicantEmail" type="email" required maxLength={254} autoComplete="email" placeholder="name@example.com" />
          <span className="hint">전형 결과를 이 주소로 보냅니다.</span>
        </div>
        <div className="field">
          <label htmlFor="phone">휴대전화<span className="optional">선택</span></label>
          <input id="phone" name="applicantPhone" type="tel" inputMode="tel" pattern="[0-9+() \-]{7,20}" maxLength={20} autoComplete="tel" placeholder="010-0000-0000" />
          <span className="hint">면접 일정 조율에만 씁니다.</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="resume">이력서</label>
        <input id="resume" name="resume" type="file" accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required />
        <span className="hint">PDF 또는 DOCX, 5MB 이하</span>
      </div>
      <div className="consent">
        <h3>개인정보 수집·이용 안내</h3>
        <table>
          <tbody>
            <tr><th scope="row">수집 항목</th><td>이름, 이메일, 휴대전화(선택), 이력서</td></tr>
            <tr><th scope="row">이용 목적</th><td>{companyName}의 채용 전형 진행과 결과 안내</td></tr>
            <tr><th scope="row">보유 기간</th><td>{companyName}의 채용 정책에 따르며, 접수 후 삭제를 요청할 수 있습니다</td></tr>
          </tbody>
        </table>
        <label className="check"><input name="privacyNoticeAcknowledged" type="checkbox" required /><span>위 내용을 읽었고 개인정보 수집·이용에 동의합니다.</span></label>
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <button type="submit" className="btn btn-wide" disabled={busy}>{busy ? "제출하는 중" : "지원서 제출"}</button>
    </form>
  );
}
