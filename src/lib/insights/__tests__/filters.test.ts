import { describe, expect, it } from "vitest";
import { EMPTY_VIEW, type ViewState, parseView, serializeView } from "../filters";

const view: ViewState = {
    usage: {
        from: "2026-11-01",
        to: "2026-11-19",
        models: ["claude-opus-5-5"],
        tools: ["calculate", "get_time"],
        conversations: ["c1"],
        modes: ["model", "replay"],
    },
    evals: { tools: ["search_notes"], checkTypes: ["answer", "citations"], report: "fixture" },
    hidden: ["cache", "eval-cost"],
};

describe("the view in the URL", () => {
    it("round-trips a full view and writes nothing for the default view", () => {
        expect(parseView(serializeView(view))).toEqual(view);
        expect(serializeView(EMPTY_VIEW).toString()).toBe("");
        expect(parseView(new URLSearchParams())).toEqual(EMPTY_VIEW);
    });

    it("gives equal views the same link whatever order the values came in", () => {
        const shuffled = { ...view, usage: { ...view.usage, tools: ["get_time", "calculate", "calculate"] } };

        expect(serializeView(parseView(serializeView(shuffled))).toString()).toBe(serializeView(view).toString());
    });

    it("drops what it does not understand instead of failing", () => {
        const parsed = parseView(new URLSearchParams("from=yesterday&to=2026-02-31&mode=fast&mode=replay&check=vibes&hide=nothing&hide=cost&model="));

        expect(parsed).toEqual({ ...EMPTY_VIEW, usage: { ...EMPTY_VIEW.usage, modes: ["replay"] }, hidden: ["cost"] });
    });

    it("turns a backwards date range around", () => {
        expect(parseView(new URLSearchParams("from=2026-11-19&to=2026-11-01")).usage).toMatchObject({ from: "2026-11-01", to: "2026-11-19" });
    });
});
