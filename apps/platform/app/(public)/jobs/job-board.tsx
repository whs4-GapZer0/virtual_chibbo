"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Monogram } from "../../components/monogram";
import { deadlineLabel } from "../../lib/format";
import type { PublicJob } from "../../lib/jobs";

const WORK_TYPES = ["정규직", "계약직", "인턴"];

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function JobBoard({ jobs, now }: { jobs: PublicJob[]; now: string }) {
  const [query, setQuery] = useState("");
  const [workType, setWorkType] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const today = useMemo(() => new Date(now), [now]);
  const workTypes = useMemo(() => WORK_TYPES.filter((type) => jobs.some((job) => job.workType === type)), [jobs]);
  const regions = useMemo(() => unique(jobs.map((job) => job.location?.split(" ")[0] ?? null)), [jobs]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (workType && job.workType !== workType) return false;
      if (region && !job.location?.startsWith(region)) return false;
      if (!needle) return true;
      return [job.title, job.companyName, job.department, job.companyIndustry, job.location, ...job.tags].some((field) => field?.toLowerCase().includes(needle));
    });
  }, [jobs, query, workType, region]);
  const filtered = Boolean(query.trim() || workType || region);
  const reset = () => { setQuery(""); setWorkType(null); setRegion(null); };

  return (
    <>
      <div className="board-tools">
        <div className="search">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="9" cy="9" r="6.25" stroke="currentColor" strokeWidth="1.75" /><path d="m14 14 4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" /></svg>
          <label htmlFor="job-search" className="sr-only">공고 검색</label>
          <input id="job-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="직무, 회사, 기술로 검색" autoComplete="off" />
        </div>
        {(workTypes.length > 1 || regions.length > 1) && (
          <div className="filters" role="group" aria-label="공고 필터">
            {workTypes.map((type) => <button key={type} type="button" className="filter" aria-pressed={workType === type} onClick={() => setWorkType(workType === type ? null : type)}>{type}</button>)}
            {workTypes.length > 0 && regions.length > 0 && <span className="filter-sep" aria-hidden="true" />}
            {regions.map((name) => <button key={name} type="button" className="filter" aria-pressed={region === name} onClick={() => setRegion(region === name ? null : name)}>{name}</button>)}
          </div>
        )}
      </div>
      <p className="board-count" role="status">{filtered ? <><strong>{visible.length}건</strong>이 조건에 맞습니다</> : <>최근 등록순</>}</p>
      {visible.length === 0 ? (
        <div className="job-list empty">
          <strong>{jobs.length === 0 ? "지금은 모집 중인 공고가 없습니다" : "조건에 맞는 공고가 없습니다"}</strong>
          {jobs.length > 0 && <p>검색어를 줄이거나 필터를 해제해 보세요.</p>}
          {filtered && <p style={{ marginTop: 16 }}><button type="button" className="btn btn-quiet btn-s" onClick={reset}>필터 모두 해제</button></p>}
        </div>
      ) : (
        <ul className="job-list">
          {visible.map((job) => {
            const deadline = deadlineLabel(job.closesAt, today);
            return (
              <li key={`${job.companySlug}/${job.slug}`}>
                <Link className="job-row" href={`/companies/${job.companySlug}/jobs/${job.slug}`}>
                  <Monogram name={job.companyName} slug={job.companySlug} />
                  <div>
                    <p className="job-company">{job.companyName}</p>
                    <h2 className="job-title">{job.title}</h2>
                    <p className="job-meta">
                      {[job.location, job.careerLevel, job.workType].filter(Boolean).map((item) => <span key={item}>{item}</span>)}
                    </p>
                  </div>
                  <div className="job-side">
                    <span className={deadline.soon ? "deadline deadline-soon" : "deadline"}>{deadline.text}</span>
                    {job.salaryRange && <span className="salary">{job.salaryRange}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
