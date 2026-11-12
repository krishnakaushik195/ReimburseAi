import path from "node:path";

export const DATA_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), ".data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
