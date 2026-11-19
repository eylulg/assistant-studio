import { z } from "zod";
import { type ViewState, viewStateSchema } from "./filters";

export const VIEWS_KEY = "assistant-studio:insight-views:v1";
const MAX_VIEWS = 20;
export const MAX_NAME_LENGTH = 60;

const savedViewSchema = z.object({ id: z.string(), name: z.string().min(1).max(MAX_NAME_LENGTH), view: viewStateSchema });
const containerSchema = z.object({ version: z.literal(1), views: z.array(z.unknown()) });

export type SavedView = z.infer<typeof savedViewSchema>;

export interface LoadedViews {
    views: SavedView[];
    /** True when something stored could not be read: the whole list, or some of its entries. Saving would overwrite it. */
    lost: boolean;
}

/**
 * Reads the saved views one by one, so one damaged or outdated entry costs only itself. An entry that names a widget
 * this version does not have is kept without that widget (the view schema drops unknown ids). Anything missing or
 * unreadable gives an empty list, never an exception.
 */
export function readViews(raw: string | null): LoadedViews {
    if (!raw) return { views: [], lost: false };
    try {
        const container = containerSchema.safeParse(JSON.parse(raw));
        if (!container.success) return { views: [], lost: true };
        const views = container.data.views.flatMap((entry) => {
            const parsed = savedViewSchema.safeParse(entry);
            return parsed.success ? [parsed.data] : [];
        });
        return { views, lost: views.length < container.data.views.length };
    } catch {
        return { views: [], lost: true };
    }
}

export function loadViews(storage: Pick<Storage, "getItem"> | null): LoadedViews {
    try {
        return readViews(storage?.getItem(VIEWS_KEY) ?? null);
    } catch {
        return { views: [], lost: false };
    }
}

/** Copies what is stored under the views key to a second key, so a save that replaces unreadable entries does not destroy them. */
export function backUpViews(storage: Pick<Storage, "getItem" | "setItem"> | null): void {
    try {
        const raw = storage?.getItem(VIEWS_KEY);
        if (raw) storage?.setItem(`${VIEWS_KEY}:backup`, raw);
    } catch {
        // A refused backup must not stop the save the user asked for.
    }
}

/** Returns false when the browser refuses (quota, private mode, blocked storage). */
export function saveViews(storage: Pick<Storage, "setItem"> | null, views: SavedView[]): boolean {
    if (!storage) return false;
    try {
        storage.setItem(VIEWS_KEY, JSON.stringify({ version: 1, views }));
        return true;
    } catch {
        return false;
    }
}

/** Saving under a name that exists replaces that view. The newest views are kept when there are too many. */
export function upsertView(views: readonly SavedView[], name: string, view: ViewState, id: string): SavedView[] {
    const clean = name.trim().slice(0, MAX_NAME_LENGTH);
    if (!clean) return [...views];
    const same = views.find((entry) => entry.name.toLowerCase() === clean.toLowerCase());
    const next = { id: same?.id ?? id, name: clean, view };
    return [...views.filter((entry) => entry !== same), next].slice(-MAX_VIEWS);
}

export function removeView(views: readonly SavedView[], id: string): SavedView[] {
    return views.filter((entry) => entry.id !== id);
}
