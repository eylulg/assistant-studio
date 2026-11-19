"use client";

import { useEffect, useRef } from "react";
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

function plural(count: number): string {
    return count === 1 ? "1 page" : `${count} pages`;
}

function describe(entry: DocumentEntry): string {
    const size = formatSize(entry.size);
    if (entry.status !== "ready" || entry.text === undefined) return size;
    if (!entry.pages) return `${size}, ${number.format(entry.text.length)} characters`;
    const total = Math.max(entry.pageCount ?? 0, entry.pages.length);
    const pages = total > entry.pages.length ? `${plural(total)}, ${entry.pages.length} with text` : plural(total);
    return `${size}, ${number.format(entry.text.length)} characters in ${pages}`;
}

const ADD_LABEL = "Add documents";
const REMOVE_BUTTONS = 'button[aria-label^="Remove "]';

function DocumentRow({ conversationId, entry, onRemove }: { conversationId: string; entry: DocumentEntry; onRemove: (id: string) => void }) {
    const nameRef = useRef<HTMLSpanElement>(null);
    const setEnabled = useDocuments((state) => state.setEnabled);
    const remove = useDocuments((state) => state.remove);
    const retry = useDocuments((state) => state.retry);

    async function handleToggle(isSelected: boolean) {
        await setEnabled(conversationId, entry.id, isSelected);
    }

    async function handleRemove() {
        onRemove(entry.id);
        await remove(conversationId, entry.id);
    }

    async function handleRetry() {
        // The Retry button is replaced by the reading state, so focus moves to the file's name, which stays.
        const retried = retry(conversationId, entry.id);
        nameRef.current?.focus();
        await retried;
    }

    return (
        <li className="flex flex-col gap-2 rounded-lg border border-subtle p-3">
            <div className="flex items-start gap-2">
                <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-fg-secondary" />
                <div className="flex min-w-0 flex-1 flex-col">
                    <span
                        ref={nameRef}
                        tabIndex={-1}
                        className="text-sm font-medium break-words text-primary outline-none focus-visible:outline-2 focus-visible:outline-focus"
                    >
                        {entry.name}
                    </span>
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
    const panelRef = useRef<HTMLDivElement>(null);
    const removedAt = useRef<number | null>(null);
    const used = entries.reduce((sum, entry) => sum + (entry.status === "ready" ? (entry.text?.length ?? 0) : 0), 0);

    // After a removal focus goes to the Remove button that took the row's place, else the one before it, else Add documents.
    useEffect(() => {
        const index = removedAt.current;
        if (index === null) return;
        removedAt.current = null;
        const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>(REMOVE_BUTTONS) ?? [];
        const add = Array.from(panelRef.current?.querySelectorAll("button") ?? []).find((button) => button.textContent?.trim() === ADD_LABEL);
        (buttons[Math.min(index, buttons.length - 1)] ?? add)?.focus();
    }, [entries]);

    function handleRemove(id: string) {
        removedAt.current = entries.findIndex((entry) => entry.id === id);
    }

    async function handleSelect(files: File[]) {
        await addDocuments(files);
    }

    return (
        <div ref={panelRef} className="flex flex-col gap-3">
            <FileDropZone
                label="Drop documents here"
                hint="Text, Markdown or PDF, up to 5 MB each"
                buttonLabel={ADD_LABEL}
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
                        <DocumentRow key={entry.id} conversationId={activeId ?? ""} entry={entry} onRemove={handleRemove} />
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
