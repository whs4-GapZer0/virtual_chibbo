import { z } from "zod";

export const EventScope = z.enum([
  "legal-corporation", "recruitment-service", "recruitment-platform", "internal-hr", "asset-management"
]);
export type EventScope = z.infer<typeof EventScope>;

export const EventSource = z.enum([
  "application-audit", "entra-sign-in", "privacy-request", "ecs-alb-cloudwatch",
  "resume-s3-cloudtrail", "rds-backup", "github-deployment", "identity-center",
  "entra-membership", "netbox", "aws-resource-inventory", "vpc-flow-logs", "approval-record"
]);
export type EventSource = z.infer<typeof EventSource>;

export const EVENT_SOURCE_POLICY: Record<EventSource, { scope: EventScope; containsTenantData: boolean; retentionDays: number; readerPermissionSet: string }> = {
  "application-audit": { scope: "recruitment-service", containsTenantData: true, retentionDays: 90, readerPermissionSet: "Chibbo-Service-Operator" },
  "entra-sign-in": { scope: "recruitment-service", containsTenantData: true, retentionDays: 90, readerPermissionSet: "Chibbo-Service-Operator" },
  "privacy-request": { scope: "recruitment-service", containsTenantData: true, retentionDays: 90, readerPermissionSet: "Chibbo-Security-Auditor" },
  "ecs-alb-cloudwatch": { scope: "recruitment-platform", containsTenantData: false, retentionDays: 30, readerPermissionSet: "Chibbo-Platform-Operator" },
  "resume-s3-cloudtrail": { scope: "recruitment-platform", containsTenantData: false, retentionDays: 365, readerPermissionSet: "Chibbo-Security-Auditor" },
  "rds-backup": { scope: "recruitment-platform", containsTenantData: false, retentionDays: 90, readerPermissionSet: "Chibbo-Platform-Operator" },
  "github-deployment": { scope: "recruitment-platform", containsTenantData: false, retentionDays: 90, readerPermissionSet: "Chibbo-Release-Operator" },
  "identity-center": { scope: "internal-hr", containsTenantData: false, retentionDays: 365, readerPermissionSet: "Chibbo-Security-Auditor" },
  "entra-membership": { scope: "internal-hr", containsTenantData: false, retentionDays: 365, readerPermissionSet: "Chibbo-Security-Auditor" },
  "netbox": { scope: "asset-management", containsTenantData: false, retentionDays: 365, readerPermissionSet: "Chibbo-Asset-Viewer" },
  "aws-resource-inventory": { scope: "asset-management", containsTenantData: false, retentionDays: 90, readerPermissionSet: "Chibbo-Asset-Viewer" },
  "vpc-flow-logs": { scope: "asset-management", containsTenantData: false, retentionDays: 30, readerPermissionSet: "Chibbo-Asset-Viewer" },
  "approval-record": { scope: "legal-corporation", containsTenantData: false, retentionDays: 365, readerPermissionSet: "Chibbo-Approval" }
};

export const UploadInitInput = z.object({ applicantName: z.string().trim().min(1).max(120), applicantEmail: z.string().trim().email().max(254), privacyNoticeVersion: z.string().min(1).max(64), privacyNoticeAcknowledged: z.literal(true), filename: z.string().min(1).max(255), mediaType: z.enum(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]), sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024) });
export const FinalizeUploadInput = z.object({ objectVersionId: z.string().min(1).max(1024), sha256: z.string().regex(/^[a-f0-9]{64}$/i) });
export const StatusChangeInput = z.object({ status: z.enum(["reviewing", "accepted", "rejected"]), rowVersion: z.number().int().min(1) });
export const DeletionRequestInput = z.object({ deletionSecret: z.string().min(43).max(128) });
