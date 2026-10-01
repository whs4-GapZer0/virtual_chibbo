import "./globals.css";
export const metadata = { title: "치뽀 채용지원", description: "합성 데이터 전용 채용 지원 서비스" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body>{children}</body></html>; }
