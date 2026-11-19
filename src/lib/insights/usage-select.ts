import { modelLabel } from "@/lib/models";
import { MODES, type UsageFilters } from "./filters";
import { memoLast } from "./memo";
import type { AnswerRecord, RecordMode } from "./records";

export const MODE_LABEL: Record<RecordMode, string> = {
    model: "Model",
    replay: "Demo replay",
    extractive: "Extractive, no model call",
    unknown: "Mode not recorded",
};

/** The series colour of each mode, so a mode keeps its colour whichever others a filter removes. */
export const MODE_COLOR: Record<RecordMode, number> = { model: 0, replay: 1, extractive: 2, unknown: 3 };

const DAY_MS = 86_400_000;
const OTHER_CONVERSATIONS = "Other conversations";
const MAX_CONVERSATIONS_SHOWN = 12;

/** Upper edges of the latency bins in milliseconds. The last bin has no upper edge. */
const LATENCY_EDGES_MS = [250, 500, 1000, 2000, 4000, 8000] as const;

function sum(records: readonly AnswerRecord[], pick: (record: AnswerRecord) => number): number {
    let total = 0;
    for (const record of records) total += pick(record);
    return total;
}

function inputTokens(record: AnswerRecord): number {
    return record.inputTokens + record.cacheReadTokens + record.cacheWriteTokens;
}

/** The answers that match every filter. Filters that are empty match everything. */
export const filterAnswers = memoLast((records: readonly AnswerRecord[], filters: UsageFilters): AnswerRecord[] => {
    const models = new Set(filters.models);
    const tools = new Set(filters.tools);
    const conversations = new Set(filters.conversations);
    const modes = new Set<string>(filters.modes);

    return records.filter(
        (record) =>
            (!filters.from || record.day >= filters.from) &&
            (!filters.to || record.day <= filters.to) &&
            (models.size === 0 || models.has(record.model)) &&
            (conversations.size === 0 || conversations.has(record.conversationId)) &&
            (modes.size === 0 || modes.has(record.mode)) &&
            (tools.size === 0 || record.tools.some((tool) => tools.has(tool))),
    );
});

/** Equal titles get a counter, so two checkboxes never read the same. */
function tellApart(entries: { id: string; title: string }[]): { id: string; title: string }[] {
    const seen = new Map<string, number>();
    return entries.map((entry) => {
        const count = (seen.get(entry.title) ?? 0) + 1;
        seen.set(entry.title, count);
        return count === 1 ? entry : { ...entry, title: `${entry.title} (${count})` };
    });
}

/** What the filter controls can offer: the values that occur in the saved answers. */
export const filterOptions = memoLast((records: readonly AnswerRecord[]) => {
    const conversations = new Map<string, string>();
    for (const record of records) conversations.set(record.conversationId, record.conversationTitle);
    return {
        models: [...new Set(records.map((record) => record.model))].sort(),
        tools: [...new Set(records.flatMap((record) => record.tools))].sort(),
        conversations: tellApart(
            [...conversations].map(([id, title]) => ({ id, title })).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)),
        ),
        modes: MODES.filter((mode) => records.some((record) => record.mode === mode)),
    };
});

function dayRange(first: string, last: string): string[] {
    const days: string[] = [];
    for (let time = Date.parse(`${first}T00:00:00Z`); time <= Date.parse(`${last}T00:00:00Z`); time += DAY_MS)
        days.push(new Date(time).toISOString().slice(0, 10));
    return days;
}

function modesIn(records: readonly AnswerRecord[]): RecordMode[] {
    const present = new Set(records.map((record) => record.mode));
    return MODES.filter((mode) => present.has(mode));
}

export interface DaySeries {
    mode: RecordMode;
    values: (number | null)[];
}

function byDay(records: readonly AnswerRecord[], value: (group: AnswerRecord[]) => number | null): { days: string[]; series: DaySeries[] } {
    const first = records[0]?.day;
    const last = records[records.length - 1]?.day;
    if (!first || !last) return { days: [], series: [] };
    const days = dayRange(first, last);
    const groups = new Map<string, AnswerRecord[]>();
    for (const record of records) {
        const key = `${record.mode}|${record.day}`;
        const group = groups.get(key);
        if (group) group.push(record);
        else groups.set(key, [record]);
    }
    const series = modesIn(records).map((mode) => ({ mode, values: days.map((day) => value(groups.get(`${mode}|${day}`) ?? [])) }));
    return { days, series };
}

/** Answers per day, one series per mode. A day with no answers is a real zero. Records must be oldest first. */
export const answersByDay = memoLast((records: readonly AnswerRecord[]) => byDay(records, (group) => group.length));

/** The share of input tokens served from the cache, per day. A day without input tokens is a gap, not zero. */
export const cacheShareByDay = memoLast((records: readonly AnswerRecord[]) => {
    const { days, series } = byDay(records, (group) => {
        const input = sum(group, inputTokens);
        return input > 0 ? sum(group, (record) => record.cacheReadTokens) / input : null;
    });
    return { days, series: series.filter((entry) => entry.values.some((value) => value !== null)) };
});

export interface TokenGroup {
    key: string;
    label: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}

/**
 * Tokens by model. A replay is grouped apart from the real model it imitates, and an extractive answer has no
 * model at all, so demo numbers never add to real ones.
 */
export const tokensByModel = memoLast((records: readonly AnswerRecord[]): TokenGroup[] => {
    const groups = new Map<string, TokenGroup>();
    for (const record of records) {
        const key = record.mode === "extractive" ? "extractive" : `${record.mode}|${record.model}`;
        const label =
            record.mode === "extractive"
                ? MODE_LABEL.extractive
                : record.mode === "replay"
                  ? `${modelLabel(record.model)}, demo replay`
                  : modelLabel(record.model);
        const group = groups.get(key) ?? { key, label, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        group.input += record.inputTokens;
        group.output += record.outputTokens;
        group.cacheRead += record.cacheReadTokens;
        group.cacheWrite += record.cacheWriteTokens;
        groups.set(key, group);
    }
    const total = (group: TokenGroup) => group.input + group.output + group.cacheRead + group.cacheWrite;
    return [...groups.values()].sort((a, b) => total(b) - total(a) || a.key.localeCompare(b.key));
});

export interface CostSeries {
    mode: RecordMode;
    values: number[];
}

/** The most expensive conversations, one series per mode so demo cost stays visibly apart. The rest are summed into one category. */
export const costByConversation = memoLast((records: readonly AnswerRecord[]): { categories: string[]; series: CostSeries[] } => {
    const totals = new Map<string, { title: string; cost: number }>();
    for (const record of records) {
        const entry = totals.get(record.conversationId) ?? { title: record.conversationTitle, cost: 0 };
        entry.cost += record.costUsd;
        totals.set(record.conversationId, entry);
    }
    const ranked = [...totals].sort((a, b) => b[1].cost - a[1].cost || a[0].localeCompare(b[0]));
    const shown = ranked.length > MAX_CONVERSATIONS_SHOWN ? ranked.slice(0, MAX_CONVERSATIONS_SHOWN) : ranked;
    const hasOther = ranked.length > shown.length;
    const shownIds = new Set(shown.map(([id]) => id));

    const categories = tellApart(shown.map(([id, entry]) => ({ id, title: entry.title }))).map((entry) => entry.title);
    if (hasOther) categories.push(OTHER_CONVERSATIONS);

    const series = modesIn(records).map((mode) => {
        const values = categories.map(() => 0);
        for (const record of records) {
            if (record.mode !== mode) continue;
            const index = shownIds.has(record.conversationId) ? shown.findIndex(([id]) => id === record.conversationId) : categories.length - 1;
            values[index] = (values[index] ?? 0) + record.costUsd;
        }
        return { mode, values };
    });
    return { categories, series };
});

/** How many times each tool ran. When a tool filter is on, only those tools are counted. */
export const toolCallCounts = memoLast((records: readonly AnswerRecord[], onlyTools: readonly string[]): { name: string; count: number }[] => {
    const wanted = new Set(onlyTools);
    const counts = new Map<string, number>();
    for (const record of records) for (const tool of record.tools) if (wanted.size === 0 || wanted.has(tool)) counts.set(tool, (counts.get(tool) ?? 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
});

function binLabel(index: number): string {
    const seconds = (ms: number) => String(ms / 1000);
    const upper = LATENCY_EDGES_MS[index];
    const lower = LATENCY_EDGES_MS[index - 1];
    if (upper === undefined) return `Over ${seconds(lower ?? 0)} s`;
    return lower === undefined ? `Under ${seconds(upper)} s` : `${seconds(lower)} to ${seconds(upper)} s`;
}

function binOf(ms: number): number {
    const index = LATENCY_EDGES_MS.findIndex((edge) => ms < edge);
    return index === -1 ? LATENCY_EDGES_MS.length : index;
}

export interface LatencyHistogram {
    bins: string[];
    firstToken: number[];
    total: number[];
    /** Answers with no timing recorded. They are left out of the bins, not counted as fast. */
    untimed: number;
    /** Timed answers by mode, so the chart can say how much of it is demo playback. */
    timedByMode: Partial<Record<RecordMode, number>>;
}

export const latencyHistogram = memoLast((records: readonly AnswerRecord[]): LatencyHistogram => {
    const bins = Array.from({ length: LATENCY_EDGES_MS.length + 1 }, (_, index) => binLabel(index));
    const firstToken = bins.map(() => 0);
    const total = bins.map(() => 0);
    const timedByMode: Partial<Record<RecordMode, number>> = {};
    let untimed = 0;

    for (const record of records) {
        if (record.totalMs === null) {
            untimed += 1;
            continue;
        }
        timedByMode[record.mode] = (timedByMode[record.mode] ?? 0) + 1;
        const slot = binOf(record.totalMs);
        total[slot] = (total[slot] ?? 0) + 1;
        if (record.firstTokenMs !== null) {
            const first = binOf(record.firstTokenMs);
            firstToken[first] = (firstToken[first] ?? 0) + 1;
        }
    }
    return { bins, firstToken, total, untimed, timedByMode };
});

function median(values: number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

export interface Summary {
    answers: number;
    byMode: Partial<Record<RecordMode, number>>;
    costUsd: number;
    toolCalls: number;
    /** Cache reads over all input tokens. `null` when no answer had input tokens. */
    cacheShare: number | null;
    medianFirstTokenMs: number | null;
    medianTotalMs: number | null;
    /** Answers with timing recorded. */
    timed: number;
}

export const summarize = memoLast((records: readonly AnswerRecord[]): Summary => {
    const byMode: Partial<Record<RecordMode, number>> = {};
    for (const record of records) byMode[record.mode] = (byMode[record.mode] ?? 0) + 1;
    const input = sum(records, inputTokens);
    const first = records.flatMap((record) => (record.firstTokenMs === null ? [] : [record.firstTokenMs]));
    const totals = records.flatMap((record) => (record.totalMs === null ? [] : [record.totalMs]));
    return {
        answers: records.length,
        byMode,
        costUsd: sum(records, (record) => record.costUsd),
        toolCalls: sum(records, (record) => record.tools.length),
        cacheShare: input > 0 ? sum(records, (record) => record.cacheReadTokens) / input : null,
        medianFirstTokenMs: median(first),
        medianTotalMs: median(totals),
        timed: totals.length,
    };
});
