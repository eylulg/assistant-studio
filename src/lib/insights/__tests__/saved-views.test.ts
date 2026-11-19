import { describe, expect, it } from "vitest";
import { memoryStorage } from "@/test-utils/storage";
import { EMPTY_VIEW } from "../filters";
import { VIEWS_KEY, loadViews, removeView, saveViews, upsertView } from "../saved-views";

const hidden = { ...EMPTY_VIEW, hidden: ["cache" as const] };

describe("saved views", () => {
    it("come back from storage as they were saved", () => {
        const storage = memoryStorage();
        const views = upsertView([], "  Cache hidden ", hidden, "v1");

        expect(saveViews(storage, views)).toBe(true);

        expect(loadViews(storage)).toEqual([{ id: "v1", name: "Cache hidden", view: hidden }]);
    });

    it.each([
        { name: "no storage", storage: null },
        { name: "nothing saved", storage: memoryStorage() },
        { name: "text that is not JSON", storage: memoryStorage({ [VIEWS_KEY]: "{oops" }) },
        { name: "a shape from another version", storage: memoryStorage({ [VIEWS_KEY]: JSON.stringify({ version: 2, views: [] }) }) },
        {
            name: "a view with an unknown widget",
            storage: memoryStorage({ [VIEWS_KEY]: JSON.stringify({ version: 1, views: [{ id: "a", name: "x", view: { ...EMPTY_VIEW, hidden: ["nope"] } }] }) }),
        },
    ])("load as an empty list for $name", ({ storage }) => {
        expect(loadViews(storage)).toEqual([]);
    });

    it("report a refused write instead of throwing", () => {
        expect(saveViews(memoryStorage({}, { failWrites: true }), [])).toBe(false);
        expect(saveViews(null, [])).toBe(false);
    });

    it("replace the view of the same name, ignoring case, and can be removed", () => {
        const first = upsertView([], "Weekly", EMPTY_VIEW, "v1");
        const second = upsertView(first, "weekly", hidden, "v2");

        expect(second).toEqual([{ id: "v1", name: "weekly", view: hidden }]);
        expect(removeView(second, "v1")).toEqual([]);
        expect(upsertView(second, "   ", EMPTY_VIEW, "v3")).toEqual(second);
    });
});
