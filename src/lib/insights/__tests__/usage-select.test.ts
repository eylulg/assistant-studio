import { describe, expect, it } from "vitest";
import { EMPTY_VIEW, type UsageFilters } from "../filters";
import type { AnswerRecord } from "../records";
import {
    answersByDay,
    cacheShareByDay,
    costByConversation,
    filterAnswers,
    filterOptions,
    latencyHistogram,
    summarize,
    tokensByModel,
    toolCallCounts,
} from "../usage-select";

const NO_FILTERS: UsageFilters = EMPTY_VIEW.usage;

function answer(overrides: Partial<AnswerRecord> = {}): AnswerRecord {
    return {
        id: "a",
        conversationId: "c1",
        conversationTitle: "First",
        at: Date.parse("2026-11-10T09:00:00Z"),
        day: "2026-11-10",
        model: "claude-sonnet-5-5",
        mode: "model",
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.001,
        tools: [],
        firstTokenMs: null,
        totalMs: null,
        ...overrides,
    };
}

describe("filterAnswers", () => {
    const records = [
        answer({ id: "1", day: "2026-11-09", tools: ["calculate"] }),
        answer({ id: "2", day: "2026-11-10", model: "claude-opus-5-5", conversationId: "c2" }),
        answer({ id: "3", day: "2026-11-11", mode: "replay", tools: ["get_time", "calculate"] }),
    ];

    it.each([
        { name: "no filters", filters: NO_FILTERS, ids: ["1", "2", "3"] },
        { name: "a date range, both ends included", filters: { ...NO_FILTERS, from: "2026-11-10", to: "2026-11-11" }, ids: ["2", "3"] },
        { name: "a model", filters: { ...NO_FILTERS, models: ["claude-opus-5-5"] }, ids: ["2"] },
        { name: "a conversation", filters: { ...NO_FILTERS, conversations: ["c2"] }, ids: ["2"] },
        { name: "a mode", filters: { ...NO_FILTERS, modes: ["replay" as const] }, ids: ["3"] },
        { name: "any of several tools", filters: { ...NO_FILTERS, tools: ["get_time", "nothing"] }, ids: ["3"] },
        { name: "filters that must all hold", filters: { ...NO_FILTERS, tools: ["calculate"], modes: ["replay" as const] }, ids: ["3"] },
    ])("keeps the answers for $name", ({ filters, ids }) => {
        expect(filterAnswers(records, filters).map((record) => record.id)).toEqual(ids);
    });
});

describe("the charts' data", () => {
    it("counts every day between the first and last answer, with a real zero on a quiet day and a series per mode", () => {
        const records = [
            answer({ id: "1", day: "2026-11-09" }),
            answer({ id: "2", day: "2026-11-11" }),
            answer({ id: "3", day: "2026-11-11", mode: "replay" }),
        ];

        expect(answersByDay(records)).toEqual({
            days: ["2026-11-09", "2026-11-10", "2026-11-11"],
            series: [
                { mode: "model", values: [1, 0, 1] },
                { mode: "replay", values: [0, 0, 1] },
            ],
        });
    });

    it("keeps a replay apart from the real model in the token groups and leaves out series with no tokens from the cache share", () => {
        const records = [
            answer({ id: "1", inputTokens: 100, cacheReadTokens: 300, cacheWriteTokens: 100, outputTokens: 40 }),
            answer({ id: "2", mode: "replay", inputTokens: 10, outputTokens: 5 }),
            answer({ id: "3", mode: "extractive", inputTokens: 0, outputTokens: 0 }),
        ];

        expect(tokensByModel(records).map((group) => [group.label, group.input, group.cacheRead, group.output])).toEqual([
            ["Claude Sonnet 5.5", 100, 300, 40],
            ["Claude Sonnet 5.5, demo replay", 10, 0, 5],
            ["Extractive, no model call", 0, 0, 0],
        ]);
        const share = cacheShareByDay(records);
        expect(share.series.map((entry) => entry.mode)).toEqual(["model", "replay"]);
        expect(share.series[0]?.values).toEqual([0.6]);
    });

    it("ranks conversations by cost, tells equal titles apart and sums the rest", () => {
        const records = Array.from({ length: 14 }, (_, index) =>
            answer({ id: `r${index}`, conversationId: `c${index}`, conversationTitle: index < 2 ? "Same" : `Chat ${index}`, costUsd: index + 1 }),
        );

        const { categories, series } = costByConversation(records);

        expect(categories.slice(0, 3)).toEqual(["Chat 13", "Chat 12", "Chat 11"]);
        expect(categories.at(-1)).toBe("Other conversations");
        expect(categories).toHaveLength(13);
        expect(series[0]?.values.at(-1)).toBe(1 + 2);
    });

    it("counts tool calls, restricted to the chosen tools", () => {
        const records = [answer({ tools: ["calculate", "calculate", "get_time"] }), answer({ tools: ["calculate"] })];

        expect(toolCallCounts(records, [])).toEqual([
            { name: "calculate", count: 3 },
            { name: "get_time", count: 1 },
        ]);
        expect(toolCallCounts(records, ["get_time"])).toEqual([{ name: "get_time", count: 1 }]);
    });

    it("bins latency and leaves answers with no timing out of the bins instead of counting them as fast", () => {
        const records = [
            answer({ id: "1", firstTokenMs: 100, totalMs: 900 }),
            answer({ id: "2", firstTokenMs: 600, totalMs: 9000, mode: "replay" }),
            answer({ id: "3", firstTokenMs: null, totalMs: 300 }),
            answer({ id: "4" }),
        ];

        const histogram = latencyHistogram(records);

        expect(histogram.untimed).toBe(1);
        expect(histogram.firstToken).toEqual([1, 0, 1, 0, 0, 0, 0]);
        expect(histogram.total).toEqual([0, 1, 1, 0, 0, 0, 1]);
        expect(histogram.timedByMode).toEqual({ model: 2, replay: 1 });
        expect(histogram.bins[0]).toBe("Under 0.25 s");
        expect(histogram.bins[2]).toBe("0.5 to 1 s");
        expect(histogram.bins[6]).toBe("Over 8 s");
    });

    it("summarises with no timing and no cache as unknown, not zero", () => {
        const summary = summarize([answer({ inputTokens: 0, outputTokens: 0, costUsd: 0 })]);

        expect(summary).toMatchObject({ answers: 1, cacheShare: null, medianFirstTokenMs: null, medianTotalMs: null, timed: 0 });
    });

    it("lists only values that occur", () => {
        const options = filterOptions([answer({ tools: ["b", "a"] }), answer({ id: "2", conversationId: "c2", conversationTitle: "Another", mode: "replay" })]);

        expect(options).toMatchObject({ tools: ["a", "b"], modes: ["model", "replay"], models: ["claude-sonnet-5-5"] });
        expect(options.conversations.map((entry) => entry.title)).toEqual(["Another", "First"]);
    });
});

describe("selectors on a large history", () => {
    function generate(count: number): AnswerRecord[] {
        let seed = 7;
        const next = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
        const modes = ["model", "replay", "extractive", "unknown"] as const;
        const tools = ["calculate", "get_time", "search_notes", "create_task"];
        return Array.from({ length: count }, (_, index) => {
            const day = new Date(Date.UTC(2026, 0, 1) + Math.floor(next() * 120) * 86_400_000).toISOString().slice(0, 10);
            const timed = next() > 0.3;
            return answer({
                id: `g${index}`,
                day,
                at: Date.parse(`${day}T12:00:00Z`) + index,
                conversationId: `c${Math.floor(next() * 40)}`,
                conversationTitle: `Conversation ${Math.floor(next() * 40)}`,
                mode: modes[Math.floor(next() * 4)] ?? "model",
                model: next() > 0.5 ? "claude-sonnet-5-5" : "claude-opus-5-5",
                inputTokens: Math.floor(next() * 5000),
                outputTokens: Math.floor(next() * 800),
                cacheReadTokens: Math.floor(next() * 4000),
                cacheWriteTokens: Math.floor(next() * 300),
                costUsd: next() / 50,
                tools: tools.filter(() => next() > 0.7),
                firstTokenMs: timed ? Math.floor(next() * 3000) : null,
                totalMs: timed ? Math.floor(next() * 12_000) + 3000 : null,
            });
        }).sort((a, b) => a.at - b.at);
    }

    const records = generate(1000);

    it("agrees with a plain loop over 1,000 answers", () => {
        const filters: UsageFilters = { ...NO_FILTERS, from: "2026-02-01", to: "2026-03-15", modes: ["model", "replay"], tools: ["calculate"] };
        const naive = records.filter(
            (record) =>
                record.day >= "2026-02-01" && record.day <= "2026-03-15" && ["model", "replay"].includes(record.mode) && record.tools.includes("calculate"),
        );

        const kept = filterAnswers(records, filters);

        expect(kept).toEqual(naive);
        expect(
            answersByDay(records)
                .series.flatMap((entry) => entry.values)
                .reduce<number>((total, value) => total + (value ?? 0), 0),
        ).toBe(1000);
        expect(tokensByModel(records).reduce((total, group) => total + group.output, 0)).toBe(
            records.reduce((total, record) => total + record.outputTokens, 0),
        );
        expect(summarize(records).costUsd).toBeCloseTo(
            records.reduce((total, record) => total + record.costUsd, 0),
            9,
        );
        expect(toolCallCounts(records, []).reduce((total, entry) => total + entry.count, 0)).toBe(
            records.reduce((total, record) => total + record.tools.length, 0),
        );
        const histogram = latencyHistogram(records);
        expect(histogram.total.reduce((total, value) => total + value, 0) + histogram.untimed).toBe(1000);
        const cost = costByConversation(records);
        expect(cost.series.flatMap((entry) => entry.values).reduce((total, value) => total + value, 0)).toBeCloseTo(summarize(records).costUsd, 9);
        expect(cost.categories).toHaveLength(13);
    });

    it("returns the same result object for the same inputs, so an unchanged widget does no work", () => {
        const filters: UsageFilters = { ...NO_FILTERS, models: ["claude-opus-5-5"] };
        const kept = filterAnswers(records, filters);

        expect(filterAnswers(records, filters)).toBe(kept);
        expect(summarize(kept)).toBe(summarize(kept));
        expect(filterAnswers(records, { ...filters })).not.toBe(kept);
    });
});
