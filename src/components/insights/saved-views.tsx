"use client";

import { type FormEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@eylulg/ui/button";
import { Input } from "@eylulg/ui/input";
import { Select, SelectItem } from "@eylulg/ui/select";
import { Save, Trash2 } from "lucide-react";
import { CONTROLS_PANEL_CLASS, SR_ONLY_CLASS } from "@/components/styles";
import type { ViewState } from "@/lib/insights/filters";
import { MAX_NAME_LENGTH, VIEWS_KEY, loadViews, removeView, saveViews, upsertView } from "@/lib/insights/saved-views";

const CHANGED = "assistant-studio:insight-views";

interface SavedViewsProps {
    view: ViewState;
    onApply: (view: ViewState) => void;
}

function browserStorage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function subscribe(onChange: () => void): () => void {
    window.addEventListener("storage", onChange);
    window.addEventListener(CHANGED, onChange);
    return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(CHANGED, onChange);
    };
}

function readRaw(): string | null {
    try {
        return window.localStorage.getItem(VIEWS_KEY);
    } catch {
        return null;
    }
}

function readOnServer(): string | null {
    return null;
}

/** Named views kept in this browser: the filters and which widgets are on. Applying one rewrites the URL, so it can still be linked. */
export function SavedViews({ view, onApply }: SavedViewsProps) {
    const raw = useSyncExternalStore(subscribe, readRaw, readOnServer);
    const views = useMemo(() => loadViews({ getItem: () => raw }), [raw]);
    const [name, setName] = useState("");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [status, setStatus] = useState("");
    const [error, setError] = useState<string | undefined>(undefined);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);

    function store(next: typeof views): boolean {
        if (!saveViews(browserStorage(), next)) return false;
        window.dispatchEvent(new Event(CHANGED));
        return true;
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const next = upsertView(views, name, view, crypto.randomUUID());
        if (!store(next)) {
            setError("This browser would not save the view. Allow site storage and try again.");
            return;
        }
        const saved = next.find((entry) => entry.name.toLowerCase() === name.trim().toLowerCase());
        setError(undefined);
        setSelectedId(saved?.id ?? null);
        setStatus(`Saved the view ${saved?.name ?? name.trim()}.`);
        setName("");
    }

    function handleSelect(key: string | number | null) {
        const chosen = views.find((entry) => entry.id === key);
        if (!chosen) return;
        setSelectedId(chosen.id);
        setStatus(`Applied the view ${chosen.name}.`);
        onApply(chosen.view);
    }

    function handleDelete() {
        const doomed = views.find((entry) => entry.id === selectedId);
        if (!doomed) return;
        if (!store(removeView(views, doomed.id))) {
            setError("This browser would not update the saved views. Allow site storage and try again.");
            return;
        }
        setError(undefined);
        setSelectedId(null);
        setStatus(`Deleted the view ${doomed.name}.`);
        // The button that was pressed is now disabled. Focus goes to the list of views, or to the name field when none are left.
        (views.length > 1 ? triggerRef : nameRef).current?.focus();
    }

    return (
        <section aria-label="Saved views" className={CONTROLS_PANEL_CLASS}>
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
                <Select
                    ref={triggerRef}
                    label="Saved views"
                    placeholder={views.length === 0 ? "None saved yet" : "Choose a view"}
                    isDisabled={views.length === 0}
                    items={views}
                    selectedKey={selectedId}
                    onSelectionChange={handleSelect}
                    className="sm:w-64"
                >
                    {(entry) => (
                        <SelectItem id={entry.id} textValue={entry.name}>
                            {entry.name}
                        </SelectItem>
                    )}
                </Select>
                <Button variant="secondary" iconLeading={Trash2} isDisabled={selectedId === null} onPress={handleDelete}>
                    Delete view
                </Button>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <Input
                    ref={nameRef}
                    label="View name"
                    hint="Saves the filters and which widgets are shown."
                    value={name}
                    onChange={setName}
                    maxLength={MAX_NAME_LENGTH}
                    errorMessage={error}
                    className="sm:w-64"
                />
                <Button type="submit" variant="primary" iconLeading={Save} isDisabled={name.trim() === ""} className="sm:mt-6">
                    Save view
                </Button>
            </form>
            <p role="status" className={SR_ONLY_CLASS}>
                {status}
            </p>
        </section>
    );
}
