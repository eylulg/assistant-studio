import { z } from "zod";
import rawTranscripts from "../../../evals/transcripts";
import { transcriptSchema } from "./transcripts";

/** Demo mode and the evals run on this instant, so get_time gives the same answer the recordings were made with. */
export const DEMO_NOW = "2026-11-10T09:30:00.000Z";

export const demoTranscripts = z.array(transcriptSchema).parse(rawTranscripts);
