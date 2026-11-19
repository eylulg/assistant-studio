import { z } from "zod";
import { type StoreApi, createStore } from "zustand/vanilla";
import { emptyState, loadState, saveState } from "@/lib/chat/persistence";
import { applyStreamEvent, failMessage, interruptMessage, newAssistantMessage, recordFirstToken, recordRequestTime, stopMessage } from "@/lib/chat/reducer";
import { type ChatTransport, TransportError } from "@/lib/chat/transport";
import { activePath, appendMessage, createConversation, forkUserMessage, pathTo, selectVersion as selectVersionIn, updateAssistant } from "@/lib/chat/tree";
import type { AssistantMessage, Conversation, PersistedState, Settings, ToolPart } from "@/lib/chat/types";
import { toWireMessages } from "@/lib/chat/wire";
import type { StoredDocument } from "@/lib/documents/types";
import { DEFAULT_MODEL } from "@/lib/models";
import { type StreamEvent } from "@/lib/protocol";
import { findTool, runTool } from "@/lib/tools";
import { type Task, taskSchema } from "@/lib/tools/types";

const PERSIST_DELAY_MS = 300;
const DENIED_OUTPUT = "The user denied this action.";
const SKIPPED_OUTPUT = "Skipped: the user sent a new message instead.";

export interface StudioDeps {
    transport: ChatTransport;
    /** No API key on the server, so answers replay recordings. Stamped on each new answer. */
    demo: boolean;
    /** The documents of a conversation that are ready and switched on. */
    documents: (conversationId: string) => Promise<StoredDocument[]>;
    storage: () => Storage | null;
    now: () => Date;
    newId: () => string;
    /** Batches streamed events into one state update per frame. */
    schedule: (callback: () => void) => void;
}

export interface StudioState {
    hydrated: boolean;
    conversations: Record<string, Conversation>;
    order: string[];
    activeId: string | null;
    settings: Settings;
    tasks: Task[];
    /** Set while a request is in flight. Only one answer streams at a time. */
    streaming: { conversationId: string; nodeId: string } | null;
    persistence: "ok" | "failed";

    hydrate: () => void;
    persistNow: () => void;
    newConversation: () => void;
    selectConversation: (id: string) => void;
    deleteConversation: (id: string) => void;
    send: (text: string) => Promise<void>;
    regenerate: (assistantId: string) => Promise<void>;
    editMessage: (userId: string, text: string) => Promise<void>;
    selectVersion: (nodeId: string) => void;
    stop: () => void;
    resume: (assistantId: string) => Promise<void>;
    approveTool: (assistantId: string, toolId: string, editedInput?: Record<string, unknown>) => Promise<void>;
    denyTool: (assistantId: string, toolId: string) => Promise<void>;
    toggleTask: (id: string) => void;
    removeTask: (id: string) => void;
    setModel: (model: string) => void;
    setSystemPrompt: (prompt: string) => void;
    clearAll: () => void;
}

const createdSchema = z.object({ created: taskSchema });

function persistedSlice(state: StudioState): PersistedState {
    return { version: 1, conversations: state.conversations, order: state.order, activeId: state.activeId, settings: state.settings, tasks: state.tasks };
}

function hasAwaiting(message: AssistantMessage): boolean {
    return message.parts.some((part) => part.type === "tool" && part.status === "awaiting_approval");
}

export function createStudioStore(deps: StudioDeps): StoreApi<StudioState> {
    let controller: AbortController | null = null;
    let persistTimer: ReturnType<typeof setTimeout> | null = null;

    const store = createStore<StudioState>((set, get) => {
        const stamp = () => deps.now().toISOString();

        function patchConversation(id: string, update: (conversation: Conversation) => Conversation) {
            set((state) => {
                const conversation = state.conversations[id];
                return conversation ? { conversations: { ...state.conversations, [id]: update(conversation) } } : state;
            });
        }

        function patchAssistant(conversationId: string, nodeId: string, update: (message: AssistantMessage) => AssistantMessage) {
            patchConversation(conversationId, (conversation) => updateAssistant(conversation, nodeId, update));
        }

        function readAssistant(conversationId: string, nodeId: string): AssistantMessage | null {
            const message = get().conversations[conversationId]?.nodes[nodeId]?.message;
            return message?.role === "assistant" ? message : null;
        }

        /** A new message ends any approval the user left open, so the model is not asked to wait for it. */
        function skipOpenApprovals(conversationId: string) {
            const conversation = get().conversations[conversationId];
            if (!conversation) return;
            for (const node of Object.values(conversation.nodes)) {
                if (node.message.role === "assistant" && hasAwaiting(node.message)) {
                    patchAssistant(conversationId, node.id, (message) => ({
                        ...message,
                        status: "complete",
                        parts: message.parts.map((part) =>
                            part.type === "tool" && part.status === "awaiting_approval"
                                ? { ...part, status: "cancelled" as const, output: SKIPPED_OUTPUT }
                                : part,
                        ),
                    }));
                }
            }
        }

        async function runTurn(conversationId: string, nodeId: string, resume: boolean) {
            const conversation = get().conversations[conversationId];
            const node = conversation?.nodes[nodeId];
            if (!conversation || !node || node.message.role !== "assistant") return;

            const continuing = node.message.rounds > 0;
            const upTo = continuing ? nodeId : node.parentId;
            if (!upTo) return;

            const { settings, tasks } = get();
            const wire = toWireMessages(pathTo(conversation, upTo).map((entry) => entry.message));
            const abort = new AbortController();
            controller = abort;
            set({ streaming: { conversationId, nodeId } });

            const startedAt = deps.now().getTime();
            let queue: StreamEvent[] = [];
            let scheduled = false;
            const flush = () => {
                scheduled = false;
                if (queue.length === 0) return;
                const batch = queue;
                queue = [];
                patchAssistant(conversationId, nodeId, (message) =>
                    recordFirstToken(batch.reduce(applyStreamEvent, message), batch, deps.now().getTime() - startedAt),
                );
            };

            try {
                const documents = await deps.documents(conversationId).catch(() => {
                    throw new TransportError("unavailable", "Your documents could not be read from this browser's storage. Remove them and add them again.");
                });
                const events = await deps.transport(
                    { model: node.message.model, system: settings.systemPrompt.trim() || undefined, messages: wire, tasks, documents: [], resume },
                    abort.signal,
                    documents,
                );
                for await (const event of events) {
                    queue.push(event);
                    if (!scheduled) {
                        scheduled = true;
                        deps.schedule(flush);
                    }
                }
                flush();
                // A stream that ends without `done`, `interrupted` or `error` was cut off.
                if (readAssistant(conversationId, nodeId)?.status === "streaming") patchAssistant(conversationId, nodeId, interruptMessage);
            } catch (error) {
                flush();
                if (abort.signal.aborted) patchAssistant(conversationId, nodeId, stopMessage);
                else if (error instanceof TransportError) patchAssistant(conversationId, nodeId, (message) => failMessage(message, error.message));
                else patchAssistant(conversationId, nodeId, interruptMessage);
            } finally {
                patchAssistant(conversationId, nodeId, (message) => recordRequestTime(message, deps.now().getTime() - startedAt));
                controller = null;
                set({ streaming: null });
            }
        }

        async function continueIfResolved(conversationId: string, nodeId: string) {
            const message = readAssistant(conversationId, nodeId);
            if (!message || hasAwaiting(message) || get().streaming) return;
            patchAssistant(conversationId, nodeId, (current) => ({ ...current, status: "streaming", doneReason: undefined }));
            await runTurn(conversationId, nodeId, false);
        }

        function startAnswer(conversationId: string, parentId: string): string {
            const id = deps.newId();
            patchConversation(conversationId, (conversation) =>
                appendMessage(conversation, parentId, newAssistantMessage(id, get().settings.model, stamp(), deps.demo ? "replay" : "model"), stamp()),
            );
            return id;
        }

        return {
            hydrated: false,
            ...emptyState(DEFAULT_MODEL),
            streaming: null,
            persistence: "ok",

            hydrate: () => {
                const saved = loadState(deps.storage());
                set({ ...(saved ?? {}), hydrated: true });
            },

            persistNow: () => {
                if (persistTimer) clearTimeout(persistTimer);
                persistTimer = null;
                const state = get();
                if (!state.hydrated) return;
                const saved = saveState(deps.storage(), persistedSlice(state));
                if ((state.persistence === "ok") !== saved) set({ persistence: saved ? "ok" : "failed" });
            },

            newConversation: () => {
                if (get().streaming) return;
                const id = deps.newId();
                set((state) => ({
                    conversations: { ...state.conversations, [id]: createConversation(id, stamp()) },
                    order: [id, ...state.order],
                    activeId: id,
                }));
            },

            selectConversation: (id) => {
                if (get().streaming || !get().conversations[id]) return;
                set({ activeId: id });
            },

            deleteConversation: (id) => {
                if (get().streaming) return;
                set((state) => {
                    const { [id]: _removed, ...rest } = state.conversations;
                    const order = state.order.filter((entry) => entry !== id);
                    return { conversations: rest, order, activeId: state.activeId === id ? (order[0] ?? null) : state.activeId };
                });
            },

            send: async (text) => {
                const clean = text.trim();
                if (!clean || get().streaming) return;

                let conversationId = get().activeId;
                if (!conversationId || !get().conversations[conversationId]) {
                    get().newConversation();
                    conversationId = get().activeId;
                }
                if (!conversationId) return;
                skipOpenApprovals(conversationId);

                const conversation = get().conversations[conversationId];
                const parentId = conversation ? (activePath(conversation).at(-1)?.id ?? null) : null;
                const userId = deps.newId();
                patchConversation(conversationId, (current) =>
                    appendMessage(current, parentId, { role: "user", id: userId, text: clean, createdAt: stamp() }, stamp()),
                );
                set((state) => ({ order: [conversationId, ...state.order.filter((id) => id !== conversationId)] }));
                const assistantId = startAnswer(conversationId, userId);
                await runTurn(conversationId, assistantId, false);
            },

            regenerate: async (assistantId) => {
                const { activeId, streaming } = get();
                const conversation = activeId ? get().conversations[activeId] : undefined;
                const node = conversation?.nodes[assistantId];
                if (!activeId || streaming || !node?.parentId) return;
                skipOpenApprovals(activeId);
                const id = startAnswer(activeId, node.parentId);
                await runTurn(activeId, id, false);
            },

            editMessage: async (userId, text) => {
                const { activeId, streaming } = get();
                const clean = text.trim();
                if (!activeId || streaming || !clean) return;
                skipOpenApprovals(activeId);
                const newUserId = deps.newId();
                patchConversation(activeId, (conversation) =>
                    forkUserMessage(conversation, userId, { role: "user", id: newUserId, text: clean, createdAt: stamp() }, stamp()),
                );
                const id = startAnswer(activeId, newUserId);
                await runTurn(activeId, id, false);
            },

            selectVersion: (nodeId) => {
                const { activeId, streaming } = get();
                if (!activeId || streaming) return;
                patchConversation(activeId, (conversation) => selectVersionIn(conversation, nodeId));
            },

            stop: () => controller?.abort(),

            resume: async (assistantId) => {
                const { activeId, streaming } = get();
                const message = activeId ? readAssistant(activeId, assistantId) : null;
                if (!activeId || streaming || message?.status !== "interrupted") return;
                // A cut-off answer made from the user's documents is made again, in the browser: the server never sees its text.
                if (message.mode === "extractive") return get().regenerate(assistantId);
                patchAssistant(activeId, assistantId, (current) => ({ ...current, status: "streaming", resumes: [...current.resumes, current.rounds] }));
                await runTurn(activeId, assistantId, true);
            },

            approveTool: async (assistantId, toolId, editedInput) => {
                const conversationId = get().activeId;
                const message = conversationId ? readAssistant(conversationId, assistantId) : null;
                const part = message?.parts.find((entry): entry is ToolPart => entry.type === "tool" && entry.id === toolId);
                if (!conversationId || part?.status !== "awaiting_approval") return;

                const tool = findTool(part.name);
                const started = performance.now();
                const outcome = tool
                    ? await runTool(tool, editedInput ?? part.input ?? {}, { now: deps.now, clock: "system", tasks: get().tasks, simulateLatency: false })
                    : ({ ok: false, error: `Unknown tool "${part.name}".` } as const);
                const durationMs = Math.round(performance.now() - started);

                if (outcome.ok) {
                    const created = createdSchema.safeParse(outcome.output);
                    if (created.success) set((state) => ({ tasks: [...state.tasks, created.data.created] }));
                }
                patchAssistant(conversationId, assistantId, (current) => ({
                    ...current,
                    parts: current.parts.map((entry) =>
                        entry.type === "tool" && entry.id === toolId
                            ? {
                                  ...entry,
                                  status: outcome.ok ? "done" : "error",
                                  approvedInput: editedInput,
                                  output: outcome.ok ? JSON.stringify(outcome.output) : outcome.error,
                                  durationMs,
                              }
                            : entry,
                    ),
                }));
                await continueIfResolved(conversationId, assistantId);
            },

            denyTool: async (assistantId, toolId) => {
                const conversationId = get().activeId;
                if (!conversationId || !readAssistant(conversationId, assistantId)) return;
                patchAssistant(conversationId, assistantId, (current) => ({
                    ...current,
                    parts: current.parts.map((entry) =>
                        entry.type === "tool" && entry.id === toolId && entry.status === "awaiting_approval"
                            ? { ...entry, status: "denied" as const, output: DENIED_OUTPUT }
                            : entry,
                    ),
                }));
                await continueIfResolved(conversationId, assistantId);
            },

            toggleTask: (id) => set((state) => ({ tasks: state.tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task)) })),
            removeTask: (id) => set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) })),
            setModel: (model) => set((state) => ({ settings: { ...state.settings, model } })),
            setSystemPrompt: (systemPrompt) => set((state) => ({ settings: { ...state.settings, systemPrompt } })),
            clearAll: () => {
                if (get().streaming) return;
                set({ conversations: {}, order: [], activeId: null, tasks: [] });
            },
        };
    });

    store.subscribe((state, previous) => {
        if (!state.hydrated) return;
        const changed =
            state.conversations !== previous.conversations ||
            state.settings !== previous.settings ||
            state.tasks !== previous.tasks ||
            state.activeId !== previous.activeId ||
            state.order !== previous.order;
        if (!changed || persistTimer) return;
        persistTimer = setTimeout(() => state.persistNow(), PERSIST_DELAY_MS);
    });

    return store;
}
