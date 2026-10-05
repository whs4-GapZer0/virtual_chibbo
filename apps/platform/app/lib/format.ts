export type ApplicationStatus = "draft_upload" | "submitted" | "reviewing" | "accepted" | "rejected";

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  draft_upload: "작성 중",
  submitted: "접수",
  reviewing: "검토 중",
  accepted: "합격",
  rejected: "불합격"
};

const DAY = 24 * 60 * 60 * 1000;

/** Days left until a deadline, counted in calendar days in Korea time. */
export function daysLeft(closesAt: string | Date | null, now: Date = new Date()): number | null {
  if (!closesAt) return null;
  const kst = (date: Date) => Math.floor((date.getTime() + 9 * 60 * 60 * 1000) / DAY);
  return kst(new Date(closesAt)) - kst(now);
}

export function deadlineLabel(closesAt: string | Date | null, now: Date = new Date()): { text: string; soon: boolean } {
  const left = daysLeft(closesAt, now);
  if (left === null) return { text: "상시채용", soon: false };
  if (left <= 0) return { text: "오늘 마감", soon: true };
  return { text: `D-${left}`, soon: left <= 7 };
}

export function formatDate(value: string | Date | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
}

export function formatDateTime(value: string | Date | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

/** Stable hue per company so each monogram keeps its color everywhere. */
export function companyHue(slug: string): number {
  let hash = 0;
  for (const char of slug) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
