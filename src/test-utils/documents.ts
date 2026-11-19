import type { DocumentRepository } from "@/lib/documents/repository";
import type { StoredDocument } from "@/lib/documents/types";

/** A DocumentRepository that keeps documents in memory, for tests that are not about IndexedDB. */
export function memoryRepository(initial: StoredDocument[] = []): DocumentRepository & { all: () => StoredDocument[] } {
    const documents = new Map(initial.map((document) => [document.id, document]));
    return {
        all: () => [...documents.values()],
        list: async (conversationId) => [...documents.values()].filter((document) => document.conversationId === conversationId),
        put: async (document) => {
            documents.set(document.id, document);
        },
        setEnabled: async (id, enabled) => {
            const document = documents.get(id);
            if (document) documents.set(id, { ...document, enabled });
        },
        remove: async (id) => {
            documents.delete(id);
        },
        removeOrphans: async (keep, before) => {
            for (const [id, document] of documents) if (!keep.includes(document.conversationId) && document.createdAt < before) documents.delete(id);
        },
        removeConversation: async (conversationId) => {
            for (const [id, document] of documents) if (document.conversationId === conversationId) documents.delete(id);
        },
    };
}

export function textDocument(id: string, name: string, text: string, overrides: Partial<StoredDocument> = {}): StoredDocument {
    return { id, conversationId: "c1", name, kind: "text", size: text.length, text, enabled: true, createdAt: "2026-11-10T09:30:00.000Z", ...overrides };
}
