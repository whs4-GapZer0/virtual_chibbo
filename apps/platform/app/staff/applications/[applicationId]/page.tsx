import { ApplicationDetailClient } from "./application-detail-client";
export const dynamic = "force-dynamic";
export default async function ApplicationDetail({ params }: { params: Promise<{ applicationId: string }> }) { return <main><h1>지원서 상세</h1><ApplicationDetailClient applicationId={(await params).applicationId} /></main>; }
