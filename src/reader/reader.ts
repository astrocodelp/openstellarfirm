import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import { createWorker, type Worker as OcrWorker } from "tesseract.js";
import {
  looksScanned,
  type PdfPageText,
  type PdfText,
  READER_ORIGIN,
  type ReaderAnswer,
  type ReaderJob,
  type ReaderReply,
  type ReaderRequest,
} from "../shared/reading";

/**
 * The reader: a hidden page in a sandboxed window of its own, on a session
 * whose every request but its own files is cancelled. It opens PDFs and reads
 * text from pictures, and talks to the main process only through the one
 * message port its preload hands over. It never fetches anything but the
 * files it is served, and it keeps nothing.
 */

const here = (path: string) => `${READER_ORIGIN}/${path}`;

GlobalWorkerOptions.workerSrc = here("pdf.worker.mjs");

/** The scale a scanned page is drawn at before it is read: about 150 dots an inch. */
const OCR_SCALE = 2;
/** The longest side, in pixels, of a page drawn for reading. */
const MAX_SIDE = 3000;

let ocr: { worker: OcrWorker; langs: string } | undefined;

async function ocrWorker(langs: string[]): Promise<OcrWorker> {
  const key = langs.join("+");
  if (ocr?.langs === key) return ocr.worker;
  await ocr?.worker.terminate();
  ocr = undefined;
  const worker = await createWorker(langs, 1, {
    workerPath: here("tesseract-worker.js"),
    corePath: here("tesseract-core-simd-lstm.wasm.js"),
    langPath: here("lang"),
    workerBlobURL: false,
    gzip: false,
    cacheMethod: "none",
  });
  ocr = { worker, langs: key };
  return worker;
}

async function readPicture(
  image: Blob | HTMLCanvasElement,
  langs: string[],
): Promise<string> {
  const worker = await ocrWorker(langs);
  const result = await worker.recognize(image);
  return result.data.text ?? "";
}

/** Opens a PDF. Destroying the task ends the document and its worker work. */
function openPdf(bytes: Uint8Array) {
  return getDocument({
    data: bytes,
    cMapUrl: here("cmaps/"),
    cMapPacked: true,
    wasmUrl: here("wasm/"),
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: false,
  });
}

function pageText(items: unknown[]): string {
  let out = "";
  for (const item of items) {
    const piece = item as { str?: unknown; hasEOL?: unknown };
    if (typeof piece.str !== "string") continue;
    out += piece.str;
    if (piece.hasEOL === true) out += "\n";
    else if (piece.str && !out.endsWith(" ")) out += " ";
  }
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

async function pdfText(
  job: Extract<ReaderJob, { op: "pdf-text" }>,
): Promise<PdfText> {
  const started = Date.now();
  const task = openPdf(job.bytes);
  const pdf = await task.promise;
  const pages: PdfPageText[] = [];
  let unread = 0;
  try {
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const text = pageText(content.items);
      const inTime = Date.now() - started < job.budgetMs;
      if (looksScanned(text) && n <= job.ocrPages && inTime) {
        const canvas = document.createElement("canvas");
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(
          OCR_SCALE,
          MAX_SIDE / Math.max(base.width, base.height),
        );
        const viewport = page.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvas, viewport }).promise;
        const read = await readPicture(canvas, job.langs);
        canvas.width = 0;
        canvas.height = 0;
        pages.push({ page: n, text: read, ocr: true });
      } else {
        if (looksScanned(text)) unread += 1;
        pages.push({ page: n, text, ocr: false });
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return { pages, total: pages.length, unread };
}

/** Decodes a WebP or GIF (its first frame) and draws it again as a PNG. */
async function toPng(
  bytes: Uint8Array,
  mediaType: string,
): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mediaType }),
  );
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The picture could not be drawn.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return new Uint8Array(await blob.arrayBuffer());
}

async function run(job: ReaderJob): Promise<ReaderAnswer> {
  switch (job.op) {
    case "pdf-info": {
      const task = openPdf(job.bytes);
      try {
        const pdf = await task.promise;
        return { op: "pdf-info", pages: pdf.numPages };
      } finally {
        await task.destroy();
      }
    }
    case "pdf-text":
      return { op: "pdf-text", result: await pdfText(job) };
    case "ocr":
      return {
        op: "ocr",
        text: await readPicture(
          new Blob([job.bytes as Uint8Array<ArrayBuffer>], {
            type: job.mediaType,
          }),
          job.langs,
        ),
      };
    case "to-png":
      return { op: "to-png", bytes: await toPng(job.bytes, job.mediaType) };
  }
}

function isRequest(value: unknown): value is ReaderRequest {
  const request = value as ReaderRequest | null;
  return (
    typeof request === "object" &&
    request !== null &&
    typeof request.id === "number" &&
    typeof request.job === "object" &&
    request.job !== null &&
    request.job.bytes instanceof Uint8Array
  );
}

function listen(port: MessagePort): void {
  // One job at a time: the main process waits for each answer anyway.
  let queue = Promise.resolve();
  port.onmessage = (event) => {
    const request = event.data as unknown;
    if (!isRequest(request)) return;
    queue = queue.then(async () => {
      let reply: ReaderReply;
      try {
        reply = { id: request.id, ok: true, answer: await run(request.job) };
      } catch (error) {
        reply = {
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.name : "Error",
        };
      }
      port.postMessage(reply);
    });
  };
  port.start();
}

// The preload hands over the port once, as a message from this same window.
window.addEventListener("message", function take(event) {
  if (
    event.source !== window ||
    event.data !== "openstellar-reader-port" ||
    event.ports.length !== 1
  )
    return;
  const port = event.ports[0];
  if (!port) return;
  window.removeEventListener("message", take);
  listen(port);
});
