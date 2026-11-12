import "server-only";
import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { maxPagesPerDocument } from "../agent-config";
import { ocrImage } from "../ocr";
import type { AgentResult, RiskSignal } from "../types";
import type { IngestionData, PipelineContext } from "./context";

const METHOD_LABEL: Record<IngestionData["method"], string> = {
  "pdf-text": "PDF text layer",
  ocr: "OCR",
  "plain-text": "plain text",
  none: "no reader",
};

/** Agent 1 — turns the uploaded PDF, image or text file into raw text for the other agents. */
export async function runIngestion(ctx: PipelineContext): Promise<AgentResult<IngestionData>> {
  if (!ctx.file) throw new Error("Receipt file is missing");
  const { buffer, mime } = ctx.file;
  const signals: RiskSignal[] = [];
  const data: IngestionData = { method: "none", text: "", pages: null, ocrConfidence: null, pdfProducer: null, pdfCreator: null };

  if (mime === "application/pdf") {
    const maxPages = maxPagesPerDocument();
    const pdf = await getDocumentProxy(new Uint8Array(buffer), { maxImageSize: 16_777_216 });
    try {
      data.pages = pdf.numPages;
      const meta = await getMeta(pdf).catch(() => null);
      const info = (meta?.info ?? {}) as Record<string, unknown>;
      data.pdfProducer = typeof info.Producer === "string" ? info.Producer : null;
      data.pdfCreator = typeof info.Creator === "string" ? info.Creator : null;
      if (pdf.numPages <= maxPages) {
        const { text } = await extractText(pdf, { mergePages: true });
        data.text = Array.isArray(text) ? text.join("\n") : text;
        data.method = "pdf-text";
      } else {
        signals.push({
          code: "too_many_pages",
          kind: "quality",
          weight: 15,
          message: `PDF has ${pdf.numPages} pages; only documents up to ${maxPages} pages are read automatically`,
        });
      }
    } finally {
      await pdf.cleanup();
    }
  } else if (mime.startsWith("image/")) {
    try {
      const result = await ocrImage(buffer);
      data.text = result.text;
      data.ocrConfidence = Math.round(result.confidence);
      data.method = "ocr";
    } catch (error) {
      signals.push({
        code: "ocr_failed",
        kind: "quality",
        weight: 20,
        message: `OCR failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } else {
    data.text = buffer.toString("utf8");
    data.method = "plain-text";
  }

  const characters = data.text.trim().length;
  if (characters < 40 && !signals.length) {
    signals.push({
      code: "little_text",
      kind: "quality",
      weight: 15,
      message: data.method === "pdf-text" ? "PDF has no text layer (scanned document?)" : "Very little readable text found",
    });
  }
  if (data.ocrConfidence !== null && data.ocrConfidence < 60) {
    signals.push({ code: "low_ocr_confidence", kind: "quality", weight: 10, message: `Low OCR confidence (${data.ocrConfidence}%)` });
  }

  return {
    outcome: signals.length ? "flag" : "pass",
    summary: `Read ${characters} characters via ${METHOD_LABEL[data.method]}${data.ocrConfidence !== null ? ` (${data.ocrConfidence}% OCR confidence)` : ""}`,
    data,
    signals,
  };
}
