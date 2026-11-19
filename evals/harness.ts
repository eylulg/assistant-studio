import { createTransport, toWireDocument } from "@/lib/chat/transport";
import type { AssistantMessage, ToolPart } from "@/lib/chat/types";
import { DEMO_NOW } from "@/lib/engine/demo";
import { runChat } from "@/lib/engine/engine";
import type { ModelClient } from "@/lib/engine/model-client";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/prompt";
import type { Citation } from "@/lib/protocol";
import type { Task } from "@/lib/tools/types";
import { createStudioStore } from "@/store/studio-store";
import type { EvalCase } from "./cases";
import { fixture } from "./documents/fixtures";

export interface RunResult {
    message: AssistantMessage;
    tools: ToolPart[];
    text: string;
    tasks: Task[];
    citations: Citation[];
}

interface RunOptions {
    client: ModelClient;
    model: string;
    /** Real clock for live runs, the frozen demo clock for recordings. */
    clock: "frozen" | "system";
    maxOutputTokens?: number;
}

/**
 * Runs one case through the real client store and the real engine, in process: the same reducer,
 * wire builder, approval flow and tools the app uses. Only the model backend differs.
 */
export async function runCase(testCase: EvalCase, { client, model, clock, maxOutputTokens = 4096 }: RunOptions): Promise<RunResult> {
    let counter = 0;
    const documents = (testCase.documents?.ids ?? []).map(fixture);
    const extractive = testCase.documents?.via === "extractive";
    const now = () => (clock === "frozen" ? new Date(DEMO_NOW) : new Date());
    const store = createStudioStore({
        documents: async () => documents,
        // The extractive path is the browser's own answer, so it is the real transport. Anything else is the engine with the given model backend.
        transport: async (request, signal, attached) =>
            extractive
                ? createTransport({ demo: true })(request, signal, attached)
                : runChat(
                      {
                          model: request.model,
                          system: request.system ?? DEFAULT_SYSTEM_PROMPT,
                          messages: request.messages,
                          documents: attached.map(toWireDocument),
                          tasks: request.tasks,
                          resume: request.resume ?? false,
                          maxRounds: 5,
                          maxOutputTokens,
                          context: { now, clock, simulateLatency: false },
                          signal,
                      },
                      client,
                  ),
        storage: () => null,
        now,
        newId: () => `id-${(counter += 1)}`,
        schedule: (callback) => callback(),
    });
    store.setState({ hydrated: true, tasks: testCase.tasks ?? [], settings: { model, systemPrompt: "" } });

    await store.getState().send(testCase.prompt);

    const assistant = () => {
        const state = store.getState();
        const conversation = state.activeId ? state.conversations[state.activeId] : undefined;
        const nodes = conversation ? Object.values(conversation.nodes) : [];
        const last = nodes[nodes.length - 1]?.message;
        if (last?.role !== "assistant") throw new Error("The run produced no assistant message.");
        return last;
    };

    // A conversation turn can need several approvals; each approval continues the stream.
    for (let step = 0; step < 6; step += 1) {
        const message = assistant();
        const waiting = message.parts.filter((part): part is ToolPart => part.type === "tool" && part.status === "awaiting_approval");
        if (message.status !== "awaiting_approval" || waiting.length === 0) break;
        for (const part of waiting) {
            if (testCase.approval === "deny") await store.getState().denyTool(message.id, part.id);
            else await store.getState().approveTool(message.id, part.id);
        }
    }

    const message = assistant();
    if (message.status === "error") throw new Error(message.error ?? "The run ended with an error.");
    return {
        message,
        tools: message.parts.filter((part): part is ToolPart => part.type === "tool"),
        text: message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n"),
        tasks: store.getState().tasks,
        citations: message.parts.flatMap((part) => (part.type === "text" ? (part.citations ?? []).map((placed) => placed.citation) : [])),
    };
}
