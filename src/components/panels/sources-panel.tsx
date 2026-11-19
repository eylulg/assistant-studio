"use client";

import { Button } from "@eylulg/ui/button";
import { FileDropZone } from "@eylulg/ui/file-drop-zone";
import { IconButton } from "@eylulg/ui/icon-button";
import { Spinner } from "@eylulg/ui/spinner";
import { Switch } from "@eylulg/ui/switch";
import { FileText, Trash2 } from "lucide-react";
import { META_CLASS } from "@/components/styles";
import { ACCEPTED_FILE_TYPES, MAX_TOTAL_CHARS } from "@/lib/documents/limits";
import type { DocumentEntry } from "@/store/documents-store";
import { useAddDocuments, useDocuments, useStudio } from "../studio-context";

const NO_ENTRIES: DocumentEntry[] = [];
const number = new Intl.NumberFormat("en");

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describe(entry: DocumentEntry): string {
    const size = formatSize(entry.size);
    if (entry.status !== "ready" || entry.text === undefined) return size;
    const pages = entry.pages ? ` in ${entry.pages.length === 1 ? "1 page" : `${entry.pages.length} pages`}` : "";
    return `${size}, ${number.format(entry.text.length)} characters${pages}`;
}

function DocumentRow({ conversationId, entry }: { conversationId: string; entry: DocumentEntry }) {
    const setEnabled = useDocuments((state) => state.setEnabled);
    const remove = useDocuments((state) => state.remove);
    const retry = useDocuments((state) => state.retry);

    async function handleToggle(isSelected: boolean) {
        await setEnabled(conversationId, entry.id, isSelected);
    }

    async function handleRemove() {
        await remove(conversationId, entry.id);
    }

    async function handleRetry() {
        await retry(conversationId, entry.id);
    }

    return (
        <li className="flex flex-col gap-2 rounded-lg border border-subtle p-3">
            <div className="flex items-start gap-2">
                <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-secondary" />
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium break-words text-primary">{entry.name}</span>
                    <span className={META_CLASS}>{describe(entry)}</span>
                </div>
                <IconButton icon={Trash2} size="sm" variant="tertiary" aria-label={`Remove ${entry.name}`} onPress={handleRemove} />
            </div>
            {entry.status === "reading" ? (
                <p className="flex items-center gap-2 text-sm text-secondary">
                    <Spinner size="sm" /> Reading
                </p>
            ) : null}
            {entry.status === "ready" ? (
                <Switch size="sm" isSelected={entry.enabled} onChange={handleToggle} aria-label={`Use ${entry.name}`}>
                    Use
                </Switch>
            ) : null}
            {entry.status === "failed" ? (
                <div className="flex flex-col items-start gap-2">
                    <p className="text-sm text-error">{entry.error}</p>
                    {entry.retryable ? (
                        <Button size="sm" variant="secondary" onPress={handleRetry} aria-label={`Retry ${entry.name}`}>
                            Retry
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </li>
    );
}

export function SourcesPanel({ demo }: { demo: boolean }) {
    const activeId = useStudio((state) => state.activeId);
    const entries = useDocuments((state) => (activeId ? state.entries[activeId] : undefined)) ?? NO_ENTRIES;
    const storage = useDocuments((state) => state.storage);
    const addDocuments = useAddDocuments();
    const used = entries.reduce((sum, entry) => sum + (entry.status === "ready" ? (entry.text?.length ?? 0) : 0), 0);

    async function handleSelect(files: File[]) {
        await addDocuments(files);
    }

    return (
        <div className="flex flex-col gap-3">
            <FileDropZone
                label="Drop documents here"
                hint="Text, Markdown or PDF, up to 5 MB each"
                buttonLabel="Add documents"
                acceptedFileTypes={ACCEPTED_FILE_TYPES}
                allowsMultiple
                isDisabled={storage === "unavailable"}
                onSelect={handleSelect}
                onReject={handleSelect}
            />
            {storage === "unavailable" ? (
                <p role="alert" className="text-sm text-error">
                    This browser blocked the storage that documents need, so they cannot be added. Allow site data and reload.
                </p>
            ) : null}
            {entries.length === 0 ? (
                <p className="text-sm text-secondary">No documents yet. Add one, then ask a question about it.</p>
            ) : (
                <ul className="flex flex-col gap-2" aria-label="Documents">
                    {entries.map((entry) => (
                        <DocumentRow key={entry.id} conversationId={activeId ?? ""} entry={entry} />
                    ))}
                </ul>
            )}
            {entries.length > 0 ? (
                <p className={META_CLASS}>
                    {number.format(used)} of {number.format(MAX_TOTAL_CHARS)} characters used. Documents that are switched on are used for the next question.
                </p>
            ) : null}
            <p className={META_CLASS}>
                {demo
                    ? "Demo mode: while a document is switched on, answers quote it and the question stays in this browser. The text of a document is never sent to the server, and earlier answers that quoted it are left out of what is sent."
                    : "Documents that are switched on are sent to the model with your question."}{" "}
                Stored in this browser only.
            </p>
        </div>
    );
}
