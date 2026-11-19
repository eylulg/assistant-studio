# Streaming and tool protocol

One endpoint, `POST /api/chat`, answers with server-sent events. The server keeps no state between requests: the browser owns the conversation and sends all of it every time. That keeps the server simple (no session store, nothing to expire) and makes interruption, resume, forking and approval ordinary cases of "send the conversation again".

## Request

```jsonc
{
  "model": "claude-sonnet-5-5", // allowlist: claude-sonnet-5-5, claude-opus-5-5
  "system": "optional, up to 4000 characters",
  "messages": [/* wire messages, see below */],
  "tasks": [/* the client's task list, at most 100 */],
  "documents": [], // live mode only, see Documents and citations; at most 10
  "resume": false, // true when the last assistant turn was cut off
}
```

Wire messages follow the Messages API shape, validated with zod: a user turn is text or `tool_result` blocks, an assistant turn is `text`, `tool_use` and opaque reasoning blocks. The conversation must end with a user turn, because the API does not take a prefilled assistant turn.

Every request is checked in this order: same origin, body size (`MAX_BODY_BYTES`, by declared and by actual length), schema, model allowlist, last turn is a user turn, per-IP rate limit.

## Response events

Each event is `data: <json>` followed by a blank line. The browser validates every event with zod and ignores one it does not know.

| Event                                        | Meaning                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `round_start`                                | A model round begins. One request can run several rounds, because each round of tool results needs another model call.             |
| `text` `{text}`                              | A text delta.                                                                                                                      |
| `reasoning` `{block}`                        | An opaque reasoning block. The browser keeps it and returns it unchanged while the turn is still running, and drops it afterwards. |
| `tool_start` `{id, name}`                    | The model began a tool call. The card appears now, with its input still streaming.                                                 |
| `tool_input` `{id, delta}`                   | A fragment of the tool input JSON (eager input streaming).                                                                         |
| `tool_call` `{id, name, input}`              | The input is complete and valid. The server is running this tool now (no side effects).                                            |
| `tool_pending` `{id, name, input}`           | The input is complete and valid, the tool has side effects, and it has not run. Waiting for the user.                              |
| `tool_result` `{id, ok, output, durationMs}` | A tool finished, or its input was rejected. `output` is the JSON string the model sees, or the error message.                      |
| `citation` `{citation}`                      | The text streamed so far is supported by a place in a document. The browser attaches it at the end of the current text part.       |
| `answer_mode` `{mode}`                       | `extractive`: the answer is built from the user's documents in the browser, with no model call. Never sent by the server.          |
| `usage` `{usage}`                            | Token counts for the round: input, output, cache reads, cache writes.                                                              |
| `done` `{reason}`                            | The request is finished: `end_turn`, `awaiting_approval`, `max_tokens`, `max_rounds`, `budget` or `refusal`.                       |
| `interrupted` `{reason}`                     | The connection to the model dropped after the answer had started.                                                                  |
| `error` `{code, message}`                    | The request failed in a way the user can read about (`rate_limited`, `model_error`, `unavailable`, ...).                           |

Failures that happen before the stream starts (bad body, wrong origin, rate limit) are plain JSON responses with `{code, message}` and a 4xx status.

## The two-phase tool protocol

Tools are classified when they are defined. `calculate`, `convert_units`, `get_time`, `search_notes`, `list_tasks` and `lookup_weather` have no side effects. `create_task` has one.

**Phase one.** The browser sends the conversation. The server streams a round. When the model asks for tools, the server validates each input against the tool's zod schema, then:

- invalid or unknown: emits `tool_result` with `ok: false` and the validation message. The model reads it and can retry. No `tool_call`.
- no side effects: emits `tool_call`, runs it (in parallel with the others of the same round), emits `tool_result`.
- side effects: emits `tool_pending` and does not run it.

When every call of the round has a result, the server appends the assistant turn and one user turn with all the results and starts the next round, inside the same request. When at least one call is pending, the server still finishes the automatic calls of that round, then emits `done` with `awaiting_approval` and closes the stream.

```
browser                                   server                                model
   | POST messages ------------------------>|                                      |
   |                                        | round 1 ---------------------------->|
   |<-- text, tool_start, tool_input -------|<-- stream ---------------------------|
   |<-- tool_call (search_notes) -----------|                                      |
   |<-- tool_pending (create_task) ---------|  (search_notes runs, create_task not)|
   |<-- tool_result (search_notes) ---------|                                      |
   |<-- done: awaiting_approval ------------|                                      |
   |                                        |                                      |
   |  user: Approve | Edit input | Deny      |                                      |
   |  browser runs create_task itself       |                                      |
   |  (task list is browser state)          |                                      |
   |                                        |                                      |
   | POST messages + tool_result ---------->|                                      |
   |                                        | round 2 ---------------------------->|
   |<-- text ... done: end_turn ------------|<-- stream ---------------------------|
```

**Phase two.** The user decides in the card:

- Approve: the browser runs the tool with the model's input and sends the result.
- Edit input: the user edits the JSON, the browser validates it with the same schema, runs the tool with the edited input and sends the result. The model's own `tool_use` block is sent back untouched, and the result says what actually ran, so the model is not misled and the history of the turn is not rewritten.
- Deny: the browser sends an error result: "The user denied this action. Do not try it again unless they ask."

When the last pending call of the message is resolved, the browser sends the whole conversation again. With several parallel side-effect calls it waits for all of them. If the user types a new message instead, open approvals are marked skipped, and the next request carries them as error results ("did not run: the conversation moved on") so the history stays valid.

Why the browser runs the side-effect tool: the task list lives in the browser, so the browser is the only place that can write to it. The server never executes a side-effect tool, so a forged request can do nothing worse than put a made-up result into the user's own context. `list_tasks` runs on the server against the `tasks` snapshot in the request.

## Documents and citations

A `citation` is `{documentId, documentName, quote, start?, end?, startPage?, endPage?}`. `start` and `end` are a character range in the document text, end exclusive, and `text.slice(start, end)` equals `quote`. A PDF citation from the model has pages only (`startPage` to `endPage`, both included, counted from 1); the browser finds `quote` on those pages. The extractive answer gives both the range and the page.

In the browser, a `citation` event adds `{at, citation}` to the current text part of the message, where `at` is the length of the text so far, so the chip follows the span it supports. A citation that arrives before any text starts an empty text part. The `answer_mode` event sets `mode: "extractive"` on the message. Both are validated with zod, like every event, and stored with the conversation.

**Live mode.** The request carries `documents`, in this order, which is the `document_index` the API cites by: `{kind: "text", id, name, text}` or `{kind: "pdf", id, name, data}` with `data` the original file in base64. The server puts them in the first user turn as document blocks with citations enabled and a cache breakpoint on the last, adds a system block about them, and maps each streamed `citations_delta` (`char_location` or `page_location`) to a `citation` event, replacing the index with the document id. A citation to an index that was not sent is dropped. The model backend emits `citation` model events with `documentIndex`, and the engine does the mapping, so replayed recordings and the real API share one path.

**Demo mode.** The server ignores `documents` and rejects a body large enough to carry any, and the browser does not send them: a question about documents is answered by the client's own transport, which emits the same events (`answer_mode`, `round_start`, `text`, `citation`, `done`) from BM25 ranked passages. A turn that continues after a tool result, or a resume, still goes to the server.

## Interruption and resume

- **Stop.** The browser aborts the fetch. The server sees the request signal abort, aborts the model stream and any running tool, and stops writing. The browser keeps every delta it already has and marks the message `stopped`. A tool that was streaming or running becomes `cancelled`.
- **Disconnect.** If the stream ends without `done`, `interrupted` or `error`, or a read fails half way, the message becomes `interrupted`. This is shown as a state with a Resume button, not as an error. A dropped connection to the model produces an explicit `interrupted` event.
- **Resume.** The browser sends the conversation with the partial answer as an assistant turn, followed by a user turn asking to continue exactly where it stopped, and `resume: true`. The new text is appended to the same message and its round is recorded in `resumes`, so later requests replay the same history. A partial tool call whose input never finished is left out of the history, because the model never completed it.
- **Reload.** A message saved while it was streaming loads as `interrupted`, so a closed tab is a resumable state too.

## Limits per request

Output tokens are counted across all rounds against `MAX_OUTPUT_TOKENS`. Each round gets only what is left as its `max_tokens`, and the request stops with `done: budget` when fewer than 300 tokens remain. `MAX_ROUNDS` caps the loop. A tool call cut off by `max_tokens` is never run.
