import Link from "next/link";
import "./globals.css";

export const metadata = { title: { default: "치뽀 채용", template: "%s | 치뽀 채용" }, description: "합성 데이터 전용 채용 지원 서비스" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <div className="shell">
            <Link href="/jobs" className="brand"><span className="brand-mark" aria-hidden="true">치</span>치뽀 채용</Link>
            <nav className="site-nav" aria-label="주요 메뉴">
              <Link href="/jobs">채용공고</Link>
              <Link href="/staff/applications">지원자 관리</Link>
            </nav>
            <Link href="/staff/applications" className="btn btn-quiet btn-s">기업 담당자</Link>
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="shell">
            <nav aria-label="바닥글 메뉴">
              <Link href="/jobs">채용공고</Link>
              <Link href="/staff/applications">기업 담당자 로그인</Link>
              <Link href="/admin/companies">플랫폼 관리</Link>
            </nav>
            <p><span className="demo-note">데모</span> 치뽀는 보안·컴플라이언스 실습을 위한 가상 기업입니다. 이 사이트의 회사, 공고, 지원자 정보는 모두 지어낸 합성 데이터입니다. 실제 이력서나 개인정보를 올리지 마세요.</p>
            <p>주식회사 치뽀 (가상 법인), 문의 help@chibbo.example</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
