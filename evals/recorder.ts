import type { ModelClient } from "@/lib/engine/model-client";
import { type Transcript, slugify, transcriptSchema } from "@/lib/engine/transcripts";

/** Wraps a model backend and writes down every event of every round it streams, with its timing. */
export function createRecorder(inner: ModelClient) {
    const rounds: Transcript["rounds"] = [];
    const client: ModelClient = {
        async *streamRound(request) {
            const events: Transcript["rounds"][number]["events"] = [];
            rounds.push({ events });
            const started = performance.now();
            for await (const event of inner.streamRound(request)) {
                events.push({ atMs: Math.round(performance.now() - started), event });
                yield event;
            }
        },
    };
    return { client, rounds };
}

interface TranscriptInput {
    prompt: string;
    model: string;
    rounds: Transcript["rounds"];
    /** The final round the model streamed after the user denied a tool, when the prompt uses a side-effect tool. */
    denied?: Transcript["rounds"][number];
    suggested: boolean;
    date: string;
}

export function buildTranscript({ prompt, model, rounds, denied, suggested, date }: TranscriptInput): Transcript {
    return transcriptSchema.parse({
        id: slugify(prompt),
        prompt,
        model,
        source: "recorded",
        note: `Recorded with ${model} on ${date}. Tool results are not stored: the local tools run again on replay.`,
        ...(suggested ? { suggested: true } : {}),
        rounds,
        ...(denied ? { denied } : {}),
    });
}

/** The module that demo mode and the evals import: one JSON file per recording, listed in order. */
export function transcriptIndexSource(ids: string[]): string {
    const sorted = [...ids].sort();
    const names = sorted.map((id) => id.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase()).replace(/^(\d)/, "_$1"));
    return `${sorted.map((id, index) => `import ${names[index]} from "./${id}.json";`).join("\n")}\n\nconst transcripts: unknown[] = [${names.join(", ")}];\n\nexport default transcripts;\n`;
}
