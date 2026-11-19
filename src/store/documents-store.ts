import { type StoreApi, createStore } from "zustand/vanilla";
import { ExtractionError, type PdfPageReader, extractDocument } from "@/lib/documents/extract";
import { MAX_DOCUMENTS, MAX_PDF_PAGES, MAX_TOTAL_BYTES, MAX_TOTAL_CHARS } from "@/lib/documents/limits";
import type { DocumentRepository } from "@/lib/documents/repository";
import type { PageSpan, QuestionDocument, StoredDocument } from "@/lib/documents/types";

/** What the Sources panel and the source viewer need to know about one document. */
export interface DocumentEntry {
    id: string;
    name: string;
    size: number;
    status: "reading" | "ready" | "failed";
    enabled: boolean;
    kind?: StoredDocument["kind"];
    text?: string;
    pages?: PageSpan[];
    /** PDFs only: all the pages of the file, which can be more than `pages`, the ones with text. */
    pageCount?: number;
    error?: string;
    retryable?: boolean;
}

export interface DocumentsDeps {
    repository: DocumentRepository;
    newId: () => string;
    now: () => Date;
    /** Reads a file into text. Replaceable so tests need no PDF engine. */
    readPdf?: PdfPageReader;
}

export interface DocumentsState {
    entries: Record<string, DocumentEntry[]>;
    /** Set when the browser's storage cannot be used, so documents would be lost on reload. */
    storage: "ok" | "unavailable";
    /** What a screen reader should hear about the last thing that happened to a document. Set by events only: loading a conversation says nothing. */
    announcement: string;
    load: (conversationId: string) => Promise<void>;
    add: (conversationId: string, files: File[]) => Promise<void>;
    retry: (conversationId: string, id: string) => Promise<void>;
    remove: (conversationId: string, id: string) => Promise<void>;
    setEnabled: (conversationId: string, id: string, enabled: boolean) => Promise<void>;
    removeConversation: (conversationId: string) => Promise<void>;
    /** Deletes stored documents of conversations that no longer exist, for example ones trimmed from the saved list. */
    prune: (conversationIds: readonly string[]) => Promise<void>;
    /**
     * Ready and switched on, for the next question; with `only`, those ids whether they are switched on or not.
     * Storage is read only with `withBytes`: the text and pages are already in memory.
     */
    forQuestion: (conversationId: string, options?: { only?: readonly string[]; withBytes?: boolean }) => Promise<QuestionDocument[]>;
}

const number = new Intl.NumberFormat("en");
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

function budgetError(existing: DocumentEntry[], text: string, size: number, pageCount = 0): ExtractionError | null {
    const ready = existing.filter((entry) => entry.status === "ready");
    if (ready.length >= MAX_DOCUMENTS) return new ExtractionError("budget", `A conversation can hold ${MAX_DOCUMENTS} documents. Remove one first.`);
    const chars = ready.reduce((sum, entry) => sum + (entry.text?.length ?? 0), 0);
    if (chars + text.length > MAX_TOTAL_CHARS)
        return new ExtractionError(
            "budget",
            `This would pass the limit of ${number.format(MAX_TOTAL_CHARS)} characters of text per conversation (${number.format(chars)} are used). Remove a document first.`,
        );
    const pagesUsed = ready.reduce((sum, entry) => sum + (entry.pageCount ?? 0), 0);
    if (pagesUsed + pageCount > MAX_PDF_PAGES)
        return new ExtractionError(
            "budget",
            `This would pass the limit of ${MAX_PDF_PAGES} PDF pages per conversation (${pagesUsed} are used). Remove a document first.`,
        );
    const bytes = ready.reduce((sum, entry) => sum + entry.size, 0);
    if (bytes + size > MAX_TOTAL_BYTES)
        return new ExtractionError(
            "budget",
            `This would pass the limit of ${MAX_TOTAL_BYTES / (1024 * 1024)} MB of files per conversation. Remove a document first.`,
        );
    return null;
}

export function createDocumentsStore(deps: DocumentsDeps): StoreApi<DocumentsState> {
    /** Files that failed with a reason retry can fix, kept so Retry does not ask for them again. */
    const retained = new Map<string, File>();
    /** A read that is waiting or running, so removing its document can stop it. */
    const reading = new Map<string, AbortController>();
    /** One file is read at a time: pdf.js parses in a worker and several large PDFs at once would hold a lot of memory. */
    let queue: Promise<void> = Promise.resolve();

    return createStore<DocumentsState>((set, get) => {
        function patch(conversationId: string, id: string, update: (entry: DocumentEntry) => DocumentEntry) {
            set((state) => ({
                entries: {
                    ...state.entries,
                    [conversationId]: (state.entries[conversationId] ?? []).map((entry) => (entry.id === id ? update(entry) : entry)),
                },
            }));
        }

        async function read(conversationId: string, id: string, file: File, signal: AbortSignal) {
            // A document removed while it waited or was being read must not be saved: it would come back after a reload.
            if (signal.aborted) return;
            try {
                const extracted = await extractDocument(file, deps.readPdf, signal);
                if (signal.aborted) return;
                const refusal = budgetError(
                    (get().entries[conversationId] ?? []).filter((entry) => entry.id !== id),
                    extracted.text,
                    extracted.size,
                    extracted.pageCount,
                );
                if (refusal) throw refusal;
                const stored: StoredDocument = {
                    id,
                    conversationId,
                    name: extracted.name,
                    kind: extracted.kind,
                    size: extracted.size,
                    text: extracted.text,
                    pages: extracted.pages,
                    pageCount: extracted.pageCount,
                    bytes: extracted.bytes,
                    enabled: true,
                    createdAt: deps.now().toISOString(),
                };
                await deps.repository.put(stored).catch(() => {
                    throw new ExtractionError("unreadable", "This file could not be saved in this browser. Storage may be full or blocked.");
                });
                if (signal.aborted) {
                    await deps.repository.remove(id).catch(() => undefined);
                    return;
                }
                retained.delete(id);
                set({ announcement: `${stored.name} is ready.` });
                patch(conversationId, id, (entry) => ({
                    ...entry,
                    status: "ready",
                    kind: stored.kind,
                    text: stored.text,
                    pages: stored.pages,
                    pageCount: stored.pageCount,
                    error: undefined,
                    retryable: undefined,
                }));
            } catch (error) {
                if (signal.aborted) return;
                const failure = error instanceof ExtractionError ? error : new ExtractionError("unreadable");
                if (failure.retryable) retained.set(id, file);
                else retained.delete(id);
                set({ announcement: `${file.name} could not be added. ${failure.message}` });
                patch(conversationId, id, (entry) => ({ ...entry, status: "failed", error: failure.message, retryable: failure.retryable }));
            }
        }

        function enqueue(conversationId: string, id: string, file: File): Promise<void> {
            const controller = new AbortController();
            reading.set(id, controller);
            queue = queue
                .then(() => read(conversationId, id, file, controller.signal))
                .finally(() => {
                    if (reading.get(id) === controller) reading.delete(id);
                });
            return queue;
        }

        function cancel(id: string) {
            retained.delete(id);
            reading.get(id)?.abort();
            reading.delete(id);
        }

        return {
            entries: {},
            storage: "ok",
            announcement: "",

            load: async (conversationId) => {
                try {
                    const stored = await deps.repository.list(conversationId);
                    const loaded: DocumentEntry[] = stored
                        .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
                        .map((document) => ({
                            id: document.id,
                            name: document.name,
                            size: document.size,
                            status: "ready",
                            enabled: document.enabled,
                            kind: document.kind,
                            text: document.text,
                            pages: document.pages,
                            pageCount: document.pageCount,
                        }));
                    // Files added while this load was running, and files that are still reading or failed, are not in storage yet and must survive it.
                    set((state) => {
                        const known = new Set(loaded.map((entry) => entry.id));
                        const kept = (state.entries[conversationId] ?? []).filter((entry) => !known.has(entry.id));
                        return { storage: "ok", entries: { ...state.entries, [conversationId]: [...loaded, ...kept] } };
                    });
                } catch {
                    set({ storage: "unavailable" });
                }
            },

            add: async (conversationId, files) => {
                const added = files.map((file) => ({ id: deps.newId(), file }));
                set((state) => ({
                    entries: {
                        ...state.entries,
                        [conversationId]: [
                            ...(state.entries[conversationId] ?? []),
                            ...added.map(({ id, file }): DocumentEntry => ({ id, name: file.name, size: file.size, status: "reading", enabled: true })),
                        ],
                    },
                }));
                set({ announcement: added.length === 1 ? `Reading ${added[0]?.file.name}.` : `Reading ${added.length} documents.` });
                await Promise.all(added.map(({ id, file }) => enqueue(conversationId, id, file)));
            },

            retry: async (conversationId, id) => {
                const file = retained.get(id);
                if (!file) return;
                patch(conversationId, id, (entry) => ({ ...entry, status: "reading", error: undefined, retryable: undefined }));
                await enqueue(conversationId, id, file);
            },

            remove: async (conversationId, id) => {
                cancel(id);
                const name = (get().entries[conversationId] ?? []).find((entry) => entry.id === id)?.name;
                if (name) set({ announcement: `Removed ${name}.` });
                set((state) => ({ entries: { ...state.entries, [conversationId]: (state.entries[conversationId] ?? []).filter((entry) => entry.id !== id) } }));
                await deps.repository.remove(id).catch(() => undefined);
            },

            setEnabled: async (conversationId, id, enabled) => {
                patch(conversationId, id, (entry) => ({ ...entry, enabled }));
                await deps.repository.setEnabled(id, enabled).catch(() => undefined);
            },

            removeConversation: async (conversationId) => {
                for (const entry of get().entries[conversationId] ?? []) cancel(entry.id);
                set((state) => {
                    const { [conversationId]: _removed, ...rest } = state.entries;
                    return { entries: rest };
                });
                await deps.repository.removeConversation(conversationId).catch(() => undefined);
            },

            prune: async (conversationIds) => {
                // A day of grace, so a document added in another tab to a conversation that is not saved yet is not taken for an orphan.
                const before = new Date(deps.now().getTime() - ORPHAN_GRACE_MS).toISOString();
                await deps.repository.removeOrphans(conversationIds, before).catch(() => undefined);
            },

            forQuestion: async (conversationId, { only, withBytes = true } = {}) => {
                const wanted = only ? new Set(only) : null;
                const usable = (get().entries[conversationId] ?? []).filter(
                    (entry) => entry.status === "ready" && (wanted ? wanted.has(entry.id) : entry.enabled),
                );
                // Questions without documents never touch storage, so chat works even where storage does not.
                if (usable.length === 0) return [];
                if (!withBytes) {
                    return usable.flatMap((entry) =>
                        entry.text === undefined || !entry.kind
                            ? []
                            : [{ id: entry.id, name: entry.name, kind: entry.kind, size: entry.size, text: entry.text, pages: entry.pages }],
                    );
                }
                const stored = new Map((await deps.repository.list(conversationId)).map((document) => [document.id, document]));
                return usable.flatMap((entry) => {
                    const document = stored.get(entry.id);
                    return document ? [document] : [];
                });
            },
        };
    });
}
