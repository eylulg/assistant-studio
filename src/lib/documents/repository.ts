import { type StoredDocument, storedDocumentSchema } from "./types";

const DATABASE = "assistant-studio";
const STORE = "documents";
const BY_CONVERSATION = "byConversation";

/** Where documents live. IndexedDB holds files of several megabytes per document, which localStorage cannot. */
export interface DocumentRepository {
    list: (conversationId: string) => Promise<StoredDocument[]>;
    put: (document: StoredDocument) => Promise<void>;
    setEnabled: (id: string, enabled: boolean) => Promise<void>;
    remove: (id: string) => Promise<void>;
    removeConversation: (conversationId: string) => Promise<void>;
    /** Deletes every document whose conversation is not in `keep` and that was added before `before` (an ISO time). */
    removeOrphans: (keep: readonly string[], before: string) => Promise<void>;
}

function settled<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
    });
}

function finished(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
        transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    });
}

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error("IndexedDB is not available."));
            return;
        }
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore(STORE, { keyPath: "id" });
            store.createIndex(BY_CONVERSATION, "conversationId");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB could not be opened."));
    });
}

export function createIndexedDbRepository(): DocumentRepository {
    let database: Promise<IDBDatabase> | null = null;

    async function open(): Promise<IDBDatabase> {
        database ??= openDatabase().catch((error: unknown) => {
            database = null;
            throw error;
        });
        return database;
    }

    async function idsOf(store: IDBObjectStore, conversationId: string): Promise<IDBValidKey[]> {
        return settled(store.index(BY_CONVERSATION).getAllKeys(conversationId));
    }

    return {
        async list(conversationId) {
            const db = await open();
            const records = await settled(db.transaction(STORE).objectStore(STORE).index(BY_CONVERSATION).getAll(conversationId));
            // Storage is a boundary: a record from an older or damaged version is skipped, not trusted.
            return records.flatMap((record) => {
                const parsed = storedDocumentSchema.safeParse(record);
                return parsed.success ? [parsed.data] : [];
            });
        },
        async put(document) {
            const db = await open();
            const transaction = db.transaction(STORE, "readwrite");
            transaction.objectStore(STORE).put(document);
            await finished(transaction);
        },
        async setEnabled(id, enabled) {
            const db = await open();
            const transaction = db.transaction(STORE, "readwrite");
            const store = transaction.objectStore(STORE);
            const parsed = storedDocumentSchema.safeParse(await settled(store.get(id)));
            if (parsed.success) store.put({ ...parsed.data, enabled });
            await finished(transaction);
        },
        async remove(id) {
            const db = await open();
            const transaction = db.transaction(STORE, "readwrite");
            transaction.objectStore(STORE).delete(id);
            await finished(transaction);
        },
        async removeConversation(conversationId) {
            const db = await open();
            const transaction = db.transaction(STORE, "readwrite");
            const store = transaction.objectStore(STORE);
            for (const key of await idsOf(store, conversationId)) store.delete(key);
            await finished(transaction);
        },
        async removeOrphans(keep, before) {
            const db = await open();
            const transaction = db.transaction(STORE, "readwrite");
            const store = transaction.objectStore(STORE);
            const kept = new Set(keep);
            const orphans = await settled(store.getAll()).then((records) =>
                records.flatMap((record: unknown) => {
                    const parsed = storedDocumentSchema.pick({ id: true, conversationId: true, createdAt: true }).safeParse(record);
                    return parsed.success && !kept.has(parsed.data.conversationId) && parsed.data.createdAt < before ? [parsed.data.id] : [];
                }),
            );
            for (const id of orphans) store.delete(id);
            await finished(transaction);
        },
    };
}
