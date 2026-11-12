import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";
import { DATA_DIR } from "./paths";

const globalForOcr = globalThis as unknown as { __ocrWorker?: Promise<Worker> };

function getWorker(): Promise<Worker> {
  if (!globalForOcr.__ocrWorker) {
    const cachePath = path.join(DATA_DIR, "tesseract");
    fs.mkdirSync(cachePath, { recursive: true });
    // The English model is downloaded once (~10 MB) and cached under .data/tesseract.
    globalForOcr.__ocrWorker = createWorker("eng", 1, { cachePath }).catch((error) => {
      globalForOcr.__ocrWorker = undefined;
      throw error;
    });
  }
  return globalForOcr.__ocrWorker;
}

export async function ocrImage(image: Buffer): Promise<{ text: string; confidence: number }> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  return { text: data.text, confidence: data.confidence };
}
