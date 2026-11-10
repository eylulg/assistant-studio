import { z } from "zod";
import { modelEventSchema } from "../protocol";

const timedEventSchema = z.object({ atMs: z.number().nonnegative(), event: modelEventSchema });
const roundSchema = z.object({ events: z.array(timedEventSchema) });

/**
 * A recorded conversation turn: what the model streamed for one prompt, round by round. `record-fixture`
 * writes these from the real API; demo mode and the evals replay them. Tool results are not stored,
 * because the tools are local and run again on replay.
 */
export const transcriptSchema = z.object({
    id: z.string().min(1),
    prompt: z.string().min(1),
    model: z.string().min(1),
    source: z.enum(["recorded", "authored"]),
    note: z.string().optional(),
    /** Offered as an example prompt in demo mode. */
    suggested: z.boolean().optional(),
    rounds: z.array(roundSchema).min(1),
    /** What the model streams after the user denies the tool the last round asked to run. */
    denied: roundSchema.optional(),
    /** The connection drops after `afterEvents` events of `round`; `resume` is what the model streams when the user resumes. */
    interruption: z.object({ round: z.number().int().nonnegative(), afterEvents: z.number().int().positive(), resume: roundSchema }).optional(),
});

export type Transcript = z.infer<typeof transcriptSchema>;
export type TimedEvent = z.infer<typeof timedEventSchema>;

export function slugify(text: string): string {
    return (
        text
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "prompt"
    );
}
