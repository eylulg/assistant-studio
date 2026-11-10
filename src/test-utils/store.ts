import type { ChatTransport } from "@/lib/chat/transport";
import type { StreamEvent } from "@/lib/protocol";
import { type StudioDeps, createStudioStore } from "@/store/studio-store";
import { memoryStorage } from "./storage";

const NOW = new Date("2026-11-10T09:30:00.000Z");

/** A transport that plays the given event lists, one per request, and remembers each request. */
export function scriptedTransport(responses: (StreamEvent[] | ((signal: AbortSignal) => AsyncIterable<StreamEvent>))[]) {
    const requests: Parameters<ChatTransport>[0][] = [];
    const transport: ChatTransport = async (request, signal) => {
        requests.push(request);
        const response = responses[requests.length - 1];
        if (!response) throw new Error(`No scripted response ${requests.length}.`);
        if (typeof response === "function") return response(signal);
        return (async function* () {
            for (const event of response) yield event;
        })();
    };
    return { transport, requests };
}

export function testStore(transport: ChatTransport, overrides: Partial<StudioDeps> = {}) {
    let counter = 0;
    const store = createStudioStore({
        transport,
        storage: () => null,
        now: () => NOW,
        newId: () => `id-${(counter += 1)}`,
        schedule: (callback) => callback(),
        ...overrides,
    });
    store.setState({ hydrated: true });
    return store;
}

export { memoryStorage };

/** Resolves when the signal aborts, also if it already has. */
export function untilAborted(signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
    });
}
