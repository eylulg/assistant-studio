import { MAX_FILE_BYTES } from "./limits";
import type { ExtractedDocument, PageSpan } from "./types";

export type ExtractionFailureCode = "type" | "too_large" | "empty" | "binary" | "encrypted" | "scanned" | "unreadable" | "budget";

const MESSAGES: Record<ExtractionFailureCode, string> = {
    type: "This file type is not supported. Add a .txt, .md or .pdf file.",
    too_large: "This file is larger than 5 MB. Split it or add a smaller one.",
    empty: "This file has no text in it.",
    binary: "This file does not look like a text file.",
    encrypted: "This PDF is password protected. Remove the password, then add it again.",
    scanned: "This PDF has no text layer, which usually means it is a scan. Run text recognition on it first, then add it again.",
    unreadable: "This file could not be read. Try again, and check that it is not damaged.",
    budget: "Adding this file would pass the limit for one conversation. Remove a document first.",
};

/** Only a read that failed for no clear reason is worth trying again: every other failure repeats with the same file. */
const RETRYABLE: ReadonlySet<ExtractionFailureCode> = new Set(["unreadable"]);

export class ExtractionError extends Error {
    readonly retryable: boolean;

    constructor(
        readonly code: ExtractionFailureCode,
        message: string = MESSAGES[code],
    ) {
        super(message);
        this.retryable = RETRYABLE.has(code);
    }
}

/** Reads the text of each page of a PDF. Replaceable so tests need no PDF engine. */
export type PdfPageReader = (bytes: ArrayBuffer) => Promise<string[]>;

function extensionOf(name: string): string {
    const dot = name.lastIndexOf(".");
    return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

/** The text of the pages joined into one string with the page boundaries inside it. Pages with no text are skipped but keep their number. */
export function assemblePages(pageTexts: readonly string[]): { text: string; pages: PageSpan[] } {
    let text = "";
    const pages: PageSpan[] = [];
    pageTexts.forEach((raw, index) => {
        const page = raw
            .replace(/\r\n?/g, "\n")
            .replace(/[^\S\n]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        if (!page) return;
        if (text) text += "\n\n";
        pages.push({ page: index + 1, start: text.length, end: text.length + page.length });
        text += page;
    });
    return { text, pages };
}

function decodeText(bytes: ArrayBuffer): string {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    const replacements = text.match(/�/g)?.length ?? 0;
    if (text.includes("\0") || replacements > Math.max(2, text.length / 100)) throw new ExtractionError("binary");
    return text;
}

async function readPdfPages(bytes: ArrayBuffer): Promise<string[]> {
    // pdf.js is large, so it is only fetched when a PDF is chosen, and it parses in a worker, not on the main thread.
    const pdfjs = await import("pdfjs-dist");
    const worker = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    pdfjs.GlobalWorkerOptions.workerPort = worker;
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
    try {
        const pdf = await task.promise;
        const pages: string[] = [];
        for (let number = 1; number <= pdf.numPages; number += 1) {
            const page = await pdf.getPage(number);
            const content = await page.getTextContent();
            pages.push(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join(""));
        }
        return pages;
    } catch (error) {
        if (error instanceof Error && error.name === "PasswordException") throw new ExtractionError("encrypted");
        throw new ExtractionError("unreadable");
    } finally {
        await task.destroy();
        worker.terminate();
    }
}

/** Checks and reads one file. Every refusal is an ExtractionError with a message the user can act on. */
export async function extractDocument(file: File, readPages: PdfPageReader = readPdfPages): Promise<ExtractedDocument> {
    const extension = extensionOf(file.name);
    if (extension !== ".txt" && extension !== ".md" && extension !== ".pdf") throw new ExtractionError("type");
    if (file.size === 0) throw new ExtractionError("empty");
    if (file.size > MAX_FILE_BYTES) throw new ExtractionError("too_large");

    let bytes: ArrayBuffer;
    try {
        bytes = await file.arrayBuffer();
    } catch {
        throw new ExtractionError("unreadable");
    }

    if (extension === ".pdf") {
        const { text, pages } = assemblePages(await readPages(bytes));
        if (!text) throw new ExtractionError("scanned");
        return { name: file.name, size: file.size, kind: "pdf", text, pages, bytes };
    }

    const text = decodeText(bytes);
    if (!text.trim()) throw new ExtractionError("empty");
    return { name: file.name, size: file.size, kind: "text", text };
}
