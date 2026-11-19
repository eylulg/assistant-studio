import type { ErrorCode, ModelEvent, WireDocument, WireMessage } from "../protocol";

export interface RoundRequest {
    model: string;
    system: string;
    messages: WireMessage[];
    /** Documents the conversation is about, attached to the first user turn. Empty when there are none. */
    documents?: readonly WireDocument[];
    maxTokens: number;
    /** True for the first round of a request that carries on from an interrupted answer. */
    resume: boolean;
    signal?: AbortSignal;
}

/** One model round: text and tool-call deltas as they stream, then a final `end` event with the complete assistant content. */
export interface ModelClient {
    streamRound: (request: RoundRequest) => AsyncIterable<ModelEvent>;
}

/** The connection to the model dropped after the answer had started. The partial answer is still good. */
export class UpstreamInterrupted extends Error {}

/** The model backend failed in a way that the user can read about. */
export class ModelFailure extends Error {
    constructor(
        readonly code: ErrorCode,
        message: string,
    ) {
        super(message);
    }
}
