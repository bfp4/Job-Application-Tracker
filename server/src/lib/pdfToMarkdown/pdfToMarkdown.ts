import { existsSync } from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import type { PdfWorkerResult } from "../pdfWorker";

/** A single upload gets 20 seconds to queue *and* parse before we give up. */
export const PDF_PARSE_TIMEOUT_MS = 20_000;

/**
 * How many PDFs may be parsed at once. Each parse is a worker thread with its
 * own V8 isolate plus a copy of the PDF, and prod is a 1GB / 2 vCPU t4g.micro —
 * so uploads have to queue rather than spawn a thread apiece. Without this cap
 * a flood of concurrent uploads trades the old event-loop stall for an OOM.
 */
export const MAX_CONCURRENT_PDF_PARSES = 2;

/** Thrown when a PDF outruns PDF_PARSE_TIMEOUT_MS and the worker is killed. */
export class PdfParseTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`PDF parsing exceeded ${timeoutMs}ms and was cancelled.`);
    this.name = "PdfParseTimeoutError";
  }
}

let activeParses = 0;
/** Callbacks for uploads waiting on a slot, in arrival order. */
const waitingForSlot: Array<() => void> = [];

/**
 * Takes one of the parse slots, waiting in line if they're all busy. Rejects if
 * the caller's whole budget runs out before a slot frees up, so a backlog can't
 * grow without bound.
 */
function acquireSlot(deadline: number): Promise<void> {
  if (activeParses < MAX_CONCURRENT_PDF_PARSES) {
    activeParses++;
    return Promise.resolve();
  }

  const budget = Math.max(0, deadline - Date.now());
  return new Promise((resolve, reject) => {
    // Reached via waitingForSlot only, which is appended to below — so `timer`
    // is always assigned by the time this can run.
    const grant = () => {
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      const index = waitingForSlot.indexOf(grant);
      if (index !== -1) waitingForSlot.splice(index, 1);
      reject(new PdfParseTimeoutError(budget));
    }, budget);
    timer.unref?.();

    waitingForSlot.push(grant);
  });
}

/** How many parses hold a slot right now. Exposed so tests can watch the cap. */
export function activeParseCount(): number {
  return activeParses;
}

/** Hands the slot straight to whoever is next in line, or gives it back. */
function releaseSlot(): void {
  const next = waitingForSlot.shift();
  if (next) next();
  else activeParses--;
}

/**
 * Locates the worker entry for the way the server is currently running:
 * `.ts` under tsx (dev) and vitest, `.js` from dist/ in production.
 */
function resolveWorkerEntry(): string {
  const tsEntry = path.join(__dirname, "..", "pdfWorker.ts");
  return existsSync(tsEntry) ? tsEntry : path.join(__dirname, "..", "pdfWorker.js");
}

/** Runs one parse on its own thread, killing it if it overruns `timeoutMs`. */
function parseInWorker(buffer: Buffer, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Cloned, not transferred: the caller still needs this buffer to upload the
    // original PDF to S3, and transferring would detach it here.
    const worker = new Worker(resolveWorkerEntry(), { workerData: buffer });

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // terminate() resolves with an exit code and shouldn't reject, but an
      // unhandled rejection here would take down the process this whole change
      // exists to keep up.
      worker.terminate().catch(() => {});
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

/**
 * Converts a PDF buffer into a Markdown string, preserving headings/lists
 * structure. Plain text extraction only — no LLM involved.
 *
 * The parse runs on a worker thread under a hard timeout, with a cap on how
 * many run at once. PDF text extraction is CPU-bound and a deliberately
 * malformed file can spin for a very long time; on the main thread that would
 * stall every other request in the process.
 */
export async function convertPdfToMarkdown(
  buffer: Buffer,
  timeoutMs: number = PDF_PARSE_TIMEOUT_MS
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  await acquireSlot(deadline);
  try {
    return await parseInWorker(buffer, Math.max(1, deadline - Date.now()));
  } finally {
    releaseSlot();
  }
}
