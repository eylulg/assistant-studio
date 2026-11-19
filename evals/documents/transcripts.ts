import { z } from "zod";
import { transcriptSchema } from "@/lib/engine/transcripts";
import meals from "../transcripts/documents/meals-page-cited.json";
import warranty from "../transcripts/documents/warranty-model-cited.json";

/** Authored streams with citations, for cases that go through the engine. They are kept apart from the demo transcripts, which never see documents. */
export const documentTranscripts = z.array(transcriptSchema).parse([warranty, meals]);
