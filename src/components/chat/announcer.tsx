"use client";

import { SR_ONLY_CLASS } from "@/components/styles";
import { activePath } from "@/lib/chat/tree";
import { useStudio } from "../studio-context";

const MESSAGES = {
    streaming: "The assistant is answering.",
    awaiting_approval: "The assistant is waiting for your approval.",
    complete: "The answer is complete.",
    stopped: "Stopped. The answer so far is kept.",
    interrupted: "The connection was interrupted. You can resume the answer.",
    error: "The answer failed. You can try again.",
} as const;

/** One polite live region for the state changes that matter. The streamed text itself is not announced token by token. */
export function Announcer() {
    const conversation = useStudio((state) => (state.activeId ? state.conversations[state.activeId] : undefined));
    const last = conversation ? activePath(conversation).at(-1)?.message : undefined;
    const text = last?.role === "assistant" ? MESSAGES[last.status] : "";

    return (
        <div role="status" aria-live="polite" className={SR_ONLY_CLASS}>
            {text}
        </div>
    );
}
