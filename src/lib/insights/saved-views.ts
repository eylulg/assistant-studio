import { z } from "zod";
import { type ViewState, viewStateSchema } from "./filters";

export const VIEWS_KEY = "assistant-studio:insight-views:v1";
const MAX_VIEWS = 20;
export const MAX_NAME_LENGTH = 60;

const savedViewSchema = z.object({ id: z.string(), name: z.string().min(1).max(MAX_NAME_LENGTH), view: viewStateSchema });
const storedSchema = z.object({ version: z.literal(1), views: z.array(savedViewSchema) });

export type SavedView = z.infer<typeof savedViewSchema>;

/** Reads the saved views. Anything missing, unreadable or in another shape gives an empty list, never an exception. */
export function loadViews(storage: Pick<Storage, "getItem"> | null): SavedView[] {
    if (!storage) return [];
    try {
        const raw = storage.getItem(VIEWS_KEY);
        if (!raw) return [];
        const parsed = storedSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data.views : [];
    } catch {
        return [];
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
