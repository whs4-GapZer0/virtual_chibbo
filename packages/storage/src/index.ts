import { createHash } from "node:crypto";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
export type UploadIntentPolicy = { key: string; expiresAt: Date; fields: Record<string, string>; conditions: Array<unknown> };
export function localOnlyUploadPolicy(intentId: string, mediaType: string, kmsKeyId: string, now = new Date()): UploadIntentPolicy {
  const key = `quarantine/${intentId}`;
  return { key, expiresAt: new Date(now.getTime() + 10 * 60_000), fields: { key, "Content-Type": mediaType, "x-amz-server-side-encryption": "aws:kms", "x-amz-server-side-encryption-aws-kms-key-id": kmsKeyId, "x-amz-meta-upload-intent-id": intentId }, conditions: [["content-length-range", 1, 5 * 1024 * 1024], ["eq", "$key", key], ["eq", "$Content-Type", mediaType], ["eq", "$x-amz-server-side-encryption", "aws:kms"], ["eq", "$x-amz-server-side-encryption-aws-kms-key-id", kmsKeyId], ["eq", "$x-amz-meta-upload-intent-id", intentId]] };
}
export function inspectResume(bytes: Uint8Array, mediaType: string): { sha256: string; valid: boolean } { const pdf = bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-"; const docx = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04; return { sha256: createHash("sha256").update(bytes).digest("hex"), valid: mediaType === "application/pdf" ? pdf : mediaType.includes("wordprocessingml") ? docx : false }; }

export type S3UploadConfig = { bucket: string; kmsKeyId: string; client: S3Client };
export async function createProductionUploadPost(config: S3UploadConfig, intentId: string, mediaType: string) {
  const key = `quarantine/${intentId}`;
  return createPresignedPost(config.client, { Bucket: config.bucket, Key: key, Expires: 600, Fields: { "Content-Type": mediaType, "x-amz-server-side-encryption": "aws:kms", "x-amz-server-side-encryption-aws-kms-key-id": config.kmsKeyId, "x-amz-meta-upload-intent-id": intentId }, Conditions: [["content-length-range", 1, 5 * 1024 * 1024], ["eq", "$key", key], ["eq", "$Content-Type", mediaType], ["eq", "$x-amz-server-side-encryption", "aws:kms"], ["eq", "$x-amz-server-side-encryption-aws-kms-key-id", config.kmsKeyId], ["eq", "$x-amz-meta-upload-intent-id", intentId]] });
}
async function bodyBytes(body: unknown): Promise<Uint8Array> { if (!body || typeof body !== "object" || !("transformToByteArray" in body)) throw new Error("object body is unavailable"); return (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray(); }
export async function verifyAndPromoteVersion(config: S3UploadConfig, input: { intentId: string; key: string; versionId: string; mediaType: string; sha256: string }) {
  const head = await config.client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: input.key, VersionId: input.versionId }));
  if (head.VersionId !== input.versionId || head.Metadata?.["upload-intent-id"] !== input.intentId || head.ContentType !== input.mediaType || !head.ContentLength || head.ContentLength < 1 || head.ContentLength > 5 * 1024 * 1024 || head.ServerSideEncryption !== "aws:kms") throw new Error("uploaded object does not match the upload intent");
  const object = await config.client.send(new GetObjectCommand({ Bucket: config.bucket, Key: input.key, VersionId: input.versionId })); const inspected = inspectResume(await bodyBytes(object.Body), input.mediaType);
  if (!inspected.valid) throw new Error("invalid resume signature");
  if (inspected.sha256 !== input.sha256.toLowerCase()) throw new Error("uploaded object hash does not match");
  const acceptedKey = `accepted/${input.intentId}`;
  await config.client.send(new CopyObjectCommand({ Bucket: config.bucket, Key: acceptedKey, CopySource: `${encodeURIComponent(config.bucket)}/${encodeURIComponent(input.key)}?versionId=${encodeURIComponent(input.versionId)}`, ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.kmsKeyId, MetadataDirective: "COPY" }));
  return { acceptedKey, sizeBytes: head.ContentLength, versionId: input.versionId };
}
export async function compensatePromotion(config: S3UploadConfig, acceptedKey: string): Promise<void> { await config.client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: acceptedKey })); }
export async function getAcceptedResume(config: S3UploadConfig, input: { key: string; versionId: string }) { return config.client.send(new GetObjectCommand({ Bucket: config.bucket, Key: input.key, VersionId: input.versionId })); }
