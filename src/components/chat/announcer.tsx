"use client";

import { SR_ONLY_CLASS } from "@/components/styles";
import { activePath } from "@/lib/chat/tree";
import { useDocuments, useStudio } from "../studio-context";

const MESSAGES = {
    streaming: "The assistant is answering.",
    awaiting_approval: "The assistant is waiting for your approval.",
    complete: "The answer is complete.",
    stopped: "Stopped. The answer so far is kept.",
    interrupted: "The connection was interrupted. You can resume the answer.",
    error: "The answer failed. You can try again.",
} as const;

/** Polite live regions for the state changes that matter: one for the answer, one for documents. The streamed text itself is not announced token by token. */
export function Announcer() {
    const conversation = useStudio((state) => (state.activeId ? state.conversations[state.activeId] : undefined));
    const last = conversation ? activePath(conversation).at(-1)?.message : undefined;
    const latestDocument = useDocuments((state) => (state.entries[conversation?.id ?? ""] ?? []).at(-1));
    const answer = last?.role === "assistant" ? MESSAGES[last.status] : "";
    const document = latestDocument
        ? latestDocument.status === "reading"
            ? `Reading ${latestDocument.name}.`
            : latestDocument.status === "ready"
              ? `${latestDocument.name} is ready.`
              : `${latestDocument.name} could not be added. ${latestDocument.error ?? ""}`
        : "";

    return (
        <>
            <div role="status" aria-live="polite" className={SR_ONLY_CLASS}>
                {answer}
            </div>
            <div role="status" aria-live="polite" className={SR_ONLY_CLASS}>
                {document}
            </div>
        </>
    );
}
