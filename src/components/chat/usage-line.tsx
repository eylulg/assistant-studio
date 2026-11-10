"use client";

import { META_CLASS } from "@/components/styles";
import type { AssistantMessage } from "@/lib/chat/types";
import { estimateCostUsd, formatCost, modelLabel } from "@/lib/models";
import { useDemoMode } from "../studio-context";

const number = new Intl.NumberFormat("en");

/** Tokens and an estimated cost for one answer, summed over every model round it took. */
export function UsageLine({ message }: { message: AssistantMessage }) {
    const demo = useDemoMode();
    const { usage } = message;
    const input = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
    if (input + usage.outputTokens === 0) return null;

    return (
        <p className={META_CLASS}>
            {modelLabel(message.model)}, {number.format(input)} tokens in
            {usage.cacheReadTokens > 0 ? ` (${number.format(usage.cacheReadTokens)} cached)` : ""}, {number.format(usage.outputTokens)} out, about{" "}
            {formatCost(estimateCostUsd(message.model, usage))}
            {demo ? ", sample usage from the recording" : ""}
        </p>
    );
}
