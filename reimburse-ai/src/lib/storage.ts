import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { UPLOAD_DIR } from "./paths";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const ALLOWED_TYPES = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "text/plain": "txt",
} as const;
export type AllowedMime = keyof typeof ALLOWED_TYPES;

function looksLikeText(buf: Buffer): boolean {
  if (buf.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Detects the real file type from its bytes; the browser-supplied MIME type is never trusted. */
export function sniffMime(buf: Buffer): AllowedMime | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.length > 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (looksLikeText(buf) && !/^\s*</.test(buf.subarray(0, 64).toString("utf8"))) return "text/plain";
  return null;
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function uploadPath(tenantId: string, claimId: string, mime: AllowedMime): string {
  // Paths are built only from server-generated UUIDs, never from the uploaded file name.
  if (!/^[0-9a-f-]{36}$/.test(tenantId) || !/^[0-9a-f-]{36}$/.test(claimId)) throw new Error("Invalid id");
  // Runtime data, not source: keep the bundler's file tracing out of it.
  return path.join(/* turbopackIgnore: true */ UPLOAD_DIR, tenantId, `${claimId}.${ALLOWED_TYPES[mime]}`);
}

export async function saveUpload(tenantId: string, claimId: string, mime: AllowedMime, buf: Buffer): Promise<void> {
  const file = uploadPath(tenantId, claimId, mime);
  await fs.mkdir(/* turbopackIgnore: true */ path.dirname(file), { recursive: true });
  await fs.writeFile(/* turbopackIgnore: true */ file, buf, { flag: "wx" });
}

export async function readUpload(tenantId: string, claimId: string, mime: string): Promise<Buffer> {
  if (!(mime in ALLOWED_TYPES)) throw new Error("Unsupported stored file type");
  return fs.readFile(/* turbopackIgnore: true */ uploadPath(tenantId, claimId, mime as AllowedMime));
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^\w.\- ()]+/g, "_").slice(0, 120).trim();
  return cleaned || "receipt";
}
