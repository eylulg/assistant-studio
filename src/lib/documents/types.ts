import { z } from "zod";

/** Where a page starts and ends in the document text. Pages count from 1. */
const pageSpanSchema = z.object({ page: z.number().int().positive(), start: z.number().int().nonnegative(), end: z.number().int().nonnegative() });

export type PageSpan = z.infer<typeof pageSpanSchema>;

/** What the browser keeps for one document in IndexedDB. `text` is exactly what the model is given, so character offsets mean the same everywhere. */
export const storedDocumentSchema = z.object({
    id: z.string(),
    conversationId: z.string(),
    name: z.string(),
    kind: z.enum(["text", "pdf"]),
    /** Size of the original file in bytes. */
    size: z.number().int().nonnegative(),
    text: z.string(),
    /** PDFs only: the page boundaries inside `text`. Pages with no text are not in it. */
    pages: z.array(pageSpanSchema).optional(),
    /** PDFs only: how many pages the file has, with or without text. */
    pageCount: z.number().int().positive().optional(),
    /** The original PDF, kept so live mode can send it as a file. Text files are sent as `text`. */
    bytes: z.instanceof(ArrayBuffer).optional(),
    enabled: z.boolean(),
    createdAt: z.string(),
});

export type StoredDocument = z.infer<typeof storedDocumentSchema>;

/** What answering a question needs of a document. `bytes` is read only where the original file is sent, which is live mode. */
export type QuestionDocument = Omit<StoredDocument, "conversationId" | "enabled" | "createdAt">;

/** A piece of a document with its exact place: `text.slice(start, end)` of the document equals `text`. */
export interface Passage {
    documentId: string;
    start: number;
    end: number;
    text: string;
    page?: number;
}

/** The result of reading a file, before it is stored. */
export type ExtractedDocument = Pick<StoredDocument, "kind" | "text" | "pages" | "pageCount" | "bytes"> & { name: string; size: number };
