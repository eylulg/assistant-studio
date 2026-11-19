"use client";

import { BarChart, LineChart } from "@eylulg/ui/chart";
import { Stat } from "@eylulg/ui/stat";
import { KPI_GRID_CLASS, META_CLASS, WIDGET_WIDE_CLASS } from "@/components/styles";
import { formatDuration, formatNumber, formatPercent } from "@/lib/insights/format";
import type { AnswerRecord, RecordMode } from "@/lib/insights/records";
import {
    MODE_COLOR,
    MODE_LABEL,
    answersByDay,
    cacheShareByDay,
    costByConversation,
    latencyHistogram,
    summarize,
    tokensByModel,
    toolCallCounts,
} from "@/lib/insights/usage-select";
import { formatCost } from "@/lib/models";
import { WidgetCard } from "./widget-card";

interface WidgetProps {
    records: readonly AnswerRecord[];
}

const DAY_FORMAT: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
const USD_FORMAT: Intl.NumberFormatOptions = { style: "currency", currency: "USD", maximumFractionDigits: 4 };
const MODES: readonly RecordMode[] = ["model", "replay", "extractive", "unknown"];

function dateOf(day: string): Date {
    return new Date(`${day}T00:00:00Z`);
}

function plural(count: number, one: string, many: string): string {
    return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

/** "3 demo replay, 1 model" for the modes that occur. */
function modeBreakdown(counts: Partial<Record<RecordMode, number>>): string {
    return MODES.flatMap((mode) => {
        const count = counts[mode];
        return count ? [`${formatNumber(count)} ${MODE_LABEL[mode].toLowerCase()}`] : [];
    }).join(", ");
}

export function KpiWidget({ records }: WidgetProps) {
    const summary = summarize(records);

    return (
        <div className={KPI_GRID_CLASS}>
            <Stat isCard label="Answers" value={formatNumber(summary.answers)} detail={modeBreakdown(summary.byMode) || "None yet"} />
            <Stat isCard label="Estimated cost" value={formatCost(summary.costUsd)} detail="From list prices, an estimate" />
            <Stat
                isCard
                label="Cache-read share"
                value={summary.cacheShare === null ? "No input" : formatPercent(summary.cacheShare)}
                detail="Of all input tokens"
            />
            <Stat
                isCard
                label="Median time to first token"
                value={summary.medianFirstTokenMs === null ? "Not recorded" : formatDuration(summary.medianFirstTokenMs)}
                detail={summary.timed === 0 ? "Older answers have no timing" : `Over ${plural(summary.timed, "timed answer", "timed answers")}`}
            />
            <Stat isCard label="Tool calls" value={formatNumber(summary.toolCalls)} detail="Calls that ran" />
        </div>
    );
}

export function AnswersWidget({ records }: WidgetProps) {
    const { days, series } = answersByDay(records);

    return (
        <WidgetCard
            title="Answers over time"
            description="Answers per day, by where the answer came from."
            className={WIDGET_WIDE_CLASS}
            note="Days follow your time zone. A day with no answer is shown as zero."
        >
            <LineChart
                title="Answers over time"
                hideTitle
                locale="en"
                x={days.map(dateOf)}
                xFormat={DAY_FORMAT}
                valueFormat={{ maximumFractionDigits: 0 }}
                series={series.map((entry) => ({ id: entry.mode, label: MODE_LABEL[entry.mode], values: entry.values, colorIndex: MODE_COLOR[entry.mode] }))}
            />
        </WidgetCard>
    );
}

export function TokensWidget({ records }: WidgetProps) {
    const groups = tokensByModel(records);

    return (
        <WidgetCard
            title="Tokens by model"
            description="Uncached input, output, cache reads and cache writes."
            note="Replays are grouped apart from the model they imitate. Their token counts are samples from the recordings."
        >
            <BarChart
                title="Tokens by model"
                hideTitle
                locale="en"
                categoryLabel="Model"
                categories={groups.map((group) => group.label)}
                series={[
                    { id: "input", label: "Input", values: groups.map((group) => group.input), colorIndex: 0 },
                    { id: "output", label: "Output", values: groups.map((group) => group.output), colorIndex: 1 },
                    { id: "cache-read", label: "Cache read", values: groups.map((group) => group.cacheRead), colorIndex: 2 },
                    { id: "cache-write", label: "Cache write", values: groups.map((group) => group.cacheWrite), colorIndex: 3 },
                ]}
            />
        </WidgetCard>
    );
}

export function CacheWidget({ records }: WidgetProps) {
    const { days, series } = cacheShareByDay(records);

    return (
        <WidgetCard
            title="Cache-read share"
            description="The part of the input served from the cache, per day."
            note="A day with no input tokens is left blank, not shown as zero."
        >
            <LineChart
                title="Cache-read share"
                hideTitle
                locale="en"
                x={days.map(dateOf)}
                xFormat={DAY_FORMAT}
                valueFormat={{ style: "percent", maximumFractionDigits: 0 }}
                yDomain={[0, 1]}
                series={series.map((entry) => ({ id: entry.mode, label: MODE_LABEL[entry.mode], values: entry.values, colorIndex: MODE_COLOR[entry.mode] }))}
            />
        </WidgetCard>
    );
}

export function CostWidget({ records }: WidgetProps) {
    const { categories, series } = costByConversation(records);

    return (
        <WidgetCard
            title="Estimated cost per conversation"
            description="The twelve most expensive conversations, by mode."
            note="An estimate from list prices. Demo replay cost comes from sample usage in the recordings."
        >
            <BarChart
                title="Estimated cost per conversation"
                hideTitle
                locale="en"
                orientation="horizontal"
                grouping="stacked"
                categoryLabel="Conversation"
                valueFormat={USD_FORMAT}
                categories={categories}
                series={series.map((entry) => ({ id: entry.mode, label: MODE_LABEL[entry.mode], values: entry.values, colorIndex: MODE_COLOR[entry.mode] }))}
            />
        </WidgetCard>
    );
}

export function ToolsWidget({ records, onlyTools }: WidgetProps & { onlyTools: readonly string[] }) {
    const counts = toolCallCounts(records, onlyTools);

    return (
        <WidgetCard title="Tool calls by tool" description="Calls that ran. Denied and cancelled calls are not counted.">
            <BarChart
                title="Tool calls by tool"
                hideTitle
                locale="en"
                orientation="horizontal"
                categoryLabel="Tool"
                valueFormat={{ maximumFractionDigits: 0 }}
                categories={counts.map((entry) => entry.name)}
                series={[{ id: "calls", label: "Calls", values: counts.map((entry) => entry.count), colorIndex: 0 }]}
            />
        </WidgetCard>
    );
}

export function LatencyWidget({ records }: WidgetProps) {
    const histogram = latencyHistogram(records);
    const replay = histogram.timedByMode.replay ?? 0;
    const timed = Object.values(histogram.timedByMode).reduce((total, count) => total + count, 0);
    const notes = [
        histogram.untimed > 0
            ? `${plural(histogram.untimed, "answer has", "answers have")} no timing recorded and ${histogram.untimed === 1 ? "is" : "are"} left out.`
            : null,
        timed > 0 ? `Timed: ${modeBreakdown(histogram.timedByMode)}.` : null,
        replay > 0 ? "Demo replay timing is the pace of the recording, not model speed." : null,
    ].filter(Boolean);

    return (
        <WidgetCard
            title="Latency"
            description="How many answers fell in each time bin: first token and total."
            note={notes.length > 0 ? notes.join(" ") : undefined}
        >
            <BarChart
                title="Latency distribution"
                hideTitle
                locale="en"
                categoryLabel="Time"
                valueFormat={{ maximumFractionDigits: 0 }}
                categories={histogram.bins}
                series={[
                    { id: "first-token", label: "Time to first token", values: histogram.firstToken, colorIndex: 0 },
                    { id: "total", label: "Total time", values: histogram.total, colorIndex: 1 },
                ]}
            />
            {timed === 0 ? <p className={META_CLASS}>Answers made from now on record their timing.</p> : null}
        </WidgetCard>
    );
}
