import pdf2md from "@opendocsg/pdf2md";
import { parentPort, workerData } from "node:worker_threads";

/**
 * Worker entry point for PDF text extraction. Runs on its own thread so a
 * pathological PDF burns this thread's CPU instead of the server's event loop,
 * and can be killed outright by the parent's timeout.
 *
 * Never imported directly — spawned by convertPdfToMarkdown in pdfToMarkdown.ts.
 */

export type PdfWorkerResult =
  | { ok: true; markdown: string }
  | { ok: false; error: string };

// Structured clone hands workerData over as a Uint8Array; pdf2md wants a
// Buffer. Wrap the bytes rather than Buffer.from(view), which would copy a
// second time — these are up to 10MB on a 1GB box.
const bytes = workerData as Uint8Array;
const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

void (async () => {
  try {
    const markdown = await pdf2md(buffer);
    parentPort!.postMessage({ ok: true, markdown: markdown.trim() } satisfies PdfWorkerResult);
  } catch (err) {
    parentPort!.postMessage({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies PdfWorkerResult);
  }
})();
