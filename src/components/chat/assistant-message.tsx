"use client";

import { Badge } from "@eylulg/ui/badge";
import { Button } from "@eylulg/ui/button";
import { IconButton } from "@eylulg/ui/icon-button";
import { Spinner } from "@eylulg/ui/spinner";
import { RefreshCw, WifiOff } from "lucide-react";
import { META_CLASS } from "@/components/styles";
import type { AssistantMessage as AssistantMessageData } from "@/lib/chat/types";
import { modelLabel } from "@/lib/models";
import { useFocusComposer, useStudio } from "../studio-context";
import { Markdown } from "./markdown";
import { ToolCard } from "./tool-card";
import { UsageLine } from "./usage-line";
import { VersionPicker } from "./version-picker";

interface AssistantMessageProps {
    message: AssistantMessageData;
    turn: number;
    versions: { index: number; count: number; previousId?: string; nextId?: string };
    /** Only the last answer offers Regenerate, so the name is unique in the view. */
    isLast: boolean;
}

const DONE_NOTES: Partial<Record<NonNullable<AssistantMessageData["doneReason"]>, string>> = {
    max_tokens: "The answer reached the output limit for one request, so it stops here.",
    max_rounds: "The assistant used all the tool rounds allowed for one request and stopped.",
    budget: "The output budget for one request is used up, so the answer stops here.",
    refusal: "The model declined to answer this.",
};

export function AssistantMessage({ message, turn, versions, isLast }: AssistantMessageProps) {
    const regenerate = useStudio((state) => state.regenerate);
    const resume = useStudio((state) => state.resume);
    const isBusy = useStudio((state) => state.streaming !== null);
    const focusComposer = useFocusComposer();

    const isStreaming = message.status === "streaming";
    const note = message.doneReason ? DONE_NOTES[message.doneReason] : undefined;

    async function handleRegenerate() {
        focusComposer();
        await regenerate(message.id);
    }

    async function handleResume() {
        focusComposer();
        await resume(message.id);
    }

    return (
        <article aria-label={`Assistant answer, turn ${turn}`} className="flex flex-col gap-3">
            <header className="flex items-center gap-2">
                <span className="text-sm font-semibold text-primary">Assistant</span>
                <span className={META_CLASS}>{modelLabel(message.model)}</span>
                {isStreaming ? (
                    <Badge color="brand" size="sm">
                        Answering
                    </Badge>
                ) : null}
                {isStreaming && message.parts.length === 0 ? <Spinner size="sm" /> : null}
            </header>

            {message.parts.map((part, index) => {
                if (part.type === "text") return <Markdown key={`${part.round}-${index}`}>{part.text}</Markdown>;
                if (part.type === "tool") return <ToolCard key={part.id} assistantId={message.id} part={part} />;
                return null;
            })}

            {message.status === "interrupted" ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg bg-secondary px-4 py-3">
                    <WifiOff aria-hidden="true" className="size-4 shrink-0 text-fg-secondary" />
                    <p className="text-sm text-primary">The connection was interrupted. Your answer so far is kept.</p>
                    <Button size="sm" isDisabled={isBusy} onPress={handleResume}>
                        Resume answer
                    </Button>
                </div>
            ) : null}
            {message.status === "stopped" ? <p className="text-sm text-secondary">Stopped. This is the answer so far.</p> : null}
            {message.status === "awaiting_approval" ? <p className="text-sm text-secondary">Waiting for your approval before it continues.</p> : null}
            {message.status === "error" ? (
                <p role="alert" className="rounded-lg bg-error-subtle px-4 py-3 text-sm text-error">
                    {message.error ?? "Something went wrong."} Try again with Regenerate answer.
                </p>
            ) : null}
            {note ? <p className="text-sm text-secondary">{note}</p> : null}

            {!isStreaming ? (
                <footer className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <VersionPicker noun="answer" turn={turn} {...versions} />
                    {isLast ? (
                        <IconButton
                            icon={RefreshCw}
                            size="sm"
                            variant="tertiary"
                            aria-label="Regenerate answer"
                            isDisabled={isBusy || message.status === "awaiting_approval"}
                            onPress={handleRegenerate}
                        />
                    ) : null}
                    <UsageLine message={message} />
                </footer>
            ) : null}
        </article>
    );
}
