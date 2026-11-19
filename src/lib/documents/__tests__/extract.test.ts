import { describe, expect, it } from "vitest";
import { ExtractionError, assemblePages, extractDocument } from "../extract";
import { MAX_FILE_BYTES } from "../limits";

function file(name: string, content: BlobPart = "hello", type = "") {
    return new File([content], name, { type });
}

const pages = async () => ["Page one.", "Page two."];

describe("extractDocument", () => {
    it("reads a text file as it is, with Windows line endings and a byte order mark normalised", async () => {
        const result = await extractDocument(file("notes.md", "﻿# Notes\r\n\r\nFirst line.\r\n"));

        expect(result).toMatchObject({ name: "notes.md", kind: "text", text: "# Notes\n\nFirst line.\n" });
    });

    it("keeps the original bytes of a PDF and the page each piece of text came from", async () => {
        const result = await extractDocument(file("report.pdf", "%PDF-1.4"), pages);

        expect(result).toMatchObject({
            kind: "pdf",
            text: "Page one.\n\nPage two.",
            pages: [
                { page: 1, start: 0, end: 9 },
                { page: 2, start: 11, end: 20 },
            ],
        });
        expect(result.bytes?.byteLength).toBe(8);
    });

    it.each<{ name: string; make: () => File; reader?: () => Promise<string[]>; code: ExtractionError["code"]; retryable: boolean }>([
        { name: "a wrong file type", make: () => file("notes.docx"), code: "type", retryable: false },
        {
            name: "a type decided by the extension, not the declared type",
            make: () => file("notes.txt.exe", "x", "text/plain"),
            code: "type",
            retryable: false,
        },
        { name: "a file over the size limit", make: () => file("big.txt", new Uint8Array(MAX_FILE_BYTES + 1)), code: "too_large", retryable: false },
        { name: "a file with no bytes", make: () => file("empty.txt", ""), code: "empty", retryable: false },
        { name: "a file of only whitespace", make: () => file("blank.md", " \n\n\t"), code: "empty", retryable: false },
        {
            name: "a binary file named .txt",
            make: () => file("image.txt", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13])),
            code: "binary",
            retryable: false,
        },
        { name: "a scanned PDF with no text layer", make: () => file("scan.pdf", "%PDF"), reader: async () => ["", "  \n"], code: "scanned", retryable: false },
        {
            name: "a password protected PDF",
            make: () => file("locked.pdf", "%PDF"),
            reader: async () => {
                throw new ExtractionError("encrypted");
            },
            code: "encrypted",
            retryable: false,
        },
        {
            name: "a PDF the reader cannot parse",
            make: () => file("damaged.pdf", "%PDF"),
            reader: async () => {
                throw new ExtractionError("unreadable");
            },
            code: "unreadable",
            retryable: true,
        },
    ])("refuses $name with its own message", async ({ make, reader, code, retryable }) => {
        const failure = await extractDocument(make(), reader).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(ExtractionError);
        expect(failure).toMatchObject({ code, retryable });
        expect((failure as ExtractionError).message.length).toBeGreaterThan(20);
    });

    it("gives every refusal a different message", async () => {
        const messages = new Set(
            await Promise.all(
                ["type", "too_large", "empty", "binary", "encrypted", "scanned", "unreadable", "budget"].map(
                    async (code) => new ExtractionError(code as ExtractionError["code"]).message,
                ),
            ),
        );

        expect(messages.size).toBe(8);
    });
});

describe("assemblePages", () => {
    it("joins pages with a blank line, records where each starts and ends, and skips pages with no text without renumbering", () => {
        const result = assemblePages(["First  \r\n\r\n\r\n\r\nline", "", "Third"]);

        expect(result.text).toBe("First\n\nline\n\nThird");
        expect(result.pages).toEqual([
            { page: 1, start: 0, end: 11 },
            { page: 3, start: 13, end: 18 },
        ]);
        for (const span of result.pages) expect(result.text.slice(span.start, span.end)).not.toMatch(/^\s|\s$/);
    });
});
