import path from "node:path";

function runtimeDataDir(): string {
  const configured = process.env.REIMBURSE_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);

  if (process.env.VERCEL) return path.join(process.env.TMPDIR || "/tmp", "reimburse-ai");

  return path.join(process.cwd(), ".data");
}

export const DATA_DIR = runtimeDataDir();
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
