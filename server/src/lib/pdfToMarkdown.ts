import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { PdfWorkerResult } from "./pdfWorker";

/** A single PDF gets 20 seconds of CPU before we give up on it. */
export const PDF_PARSE_TIMEOUT_MS = 20_000;

/** Thrown when a PDF outruns PDF_PARSE_TIMEOUT_MS and the worker is killed. */
export class PdfParseTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`PDF parsing exceeded ${timeoutMs}ms and was cancelled.`);
    this.name = "PdfParseTimeoutError";
  }
}

/**
 * Locates the worker entry for the way the server is currently running:
 * `.ts` under tsx (dev) and vitest, `.js` from dist/ in production.
 */
function resolveWorkerEntry(): string {
  const tsEntry = path.join(__dirname, "pdfWorker.ts");
  return existsSync(tsEntry) ? tsEntry : path.join(__dirname, "pdfWorker.js");
}

/**
 * Converts a PDF buffer into a Markdown string, preserving headings/lists
 * structure. Plain text extraction only — no LLM involved.
 *
 * The parse runs on a worker thread under a hard timeout. PDF text extraction
 * is CPU-bound and a deliberately malformed file can spin for a very long time;
 * on the main thread that would stall every other request in the process.
 */
export function convertPdfToMarkdown(
  buffer: Buffer,
  timeoutMs: number = PDF_PARSE_TIMEOUT_MS
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(resolveWorkerEntry(), { workerData: buffer });

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };

    const timer = setTimeout(() => {
      settle(() => reject(new PdfParseTimeoutError(timeoutMs)));
    }, timeoutMs);
    // Don't hold the process open just for the timeout.
    timer.unref?.();

    worker.on("message", (result: PdfWorkerResult) => {
      settle(() =>
        result.ok ? resolve(result.markdown) : reject(new Error(result.error))
      );
    });
    worker.on("error", (err: Error) => settle(() => reject(err)));
    worker.on("exit", (code) => {
      settle(() => reject(new Error(`PDF worker stopped unexpectedly (code ${code}).`)));
    });
  });
}
