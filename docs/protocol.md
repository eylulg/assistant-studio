# Streaming and tool protocol

One endpoint, `POST /api/chat`, answers with server-sent events. The server keeps no state between requests. The browser owns the conversation and sends all of it every time, so interruption, resume, forking and approval are all "send the conversation again".

## Request

```jsonc
{
  "model": "claude-sonnet-5-5", // allowlist: claude-sonnet-5-5, claude-opus-5-5
  "system": "optional, up to 4000 characters",
  "messages": [/* Messages API shape, at most 120 */],
  "tasks": [/* the client's task list, at most 100 */],
  "documents": [], // live mode only, at most 10
  "resume": false, // true when the last assistant turn was cut off
}
```

The conversation must end with a user turn, because the API does not take a prefilled assistant turn. Checks run in this order: same origin, body size, schema, model allowlist, last turn is a user turn, per-IP rate limit. Failures before the stream starts are plain JSON `{code, message}` responses with a 4xx status.

## Response events

Each event is `data: <json>` followed by a blank line. The browser validates every event with zod and ignores unknown ones.

| Event                                        | Meaning                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `round_start`                                | A model round begins. One request can run several rounds, because tool results need another model call. |
| `text` `{text}`                              | A text delta.                                                                                           |
| `reasoning` `{block}`                        | An opaque reasoning block. Returned unchanged while the turn is running, dropped afterwards.            |
| `tool_start` `{id, name}`                    | The model began a tool call. The card appears with its input still streaming.                           |
| `tool_input` `{id, delta}`                   | A fragment of the tool input JSON.                                                                      |
| `tool_call` `{id, name, input}`              | The input is valid and the server is running this tool (no side effects).                               |
| `tool_pending` `{id, name, input}`           | The input is valid, the tool has side effects, and it has not run. Waiting for the user.                |
| `tool_result` `{id, ok, output, durationMs}` | A tool finished, or its input was rejected.                                                             |
| `citation` `{citation}`                      | The text so far is supported by a place in a document.                                                  |
| `answer_mode` `{mode}`                       | `extractive`: the answer is built from the documents in the browser. Never sent by the server.          |
| `usage` `{usage}`                            | Token counts for the round: input, output, cache reads, cache writes.                                   |
| `done` `{reason}`                            | `end_turn`, `awaiting_approval`, `max_tokens`, `max_rounds`, `budget` or `refusal`.                     |
| `interrupted` `{reason}`                     | The connection to the model dropped after the answer had started.                                       |
| `error` `{code, message}`                    | The request failed in a way the user can read about.                                                    |

The browser also stores two fields on each answer that never travel over the wire: `mode` (`model`, `replay` or `extractive`) and `timing` (`firstTokenMs`, `totalMs`). Insights reads them. Older answers have neither, and Insights says so instead of showing zero.

## The two-phase tool protocol

`calculate`, `convert_units`, `get_time`, `search_notes`, `list_tasks` and `lookup_weather` have no side effects. `create_task` has one.

**Phase one.** The server streams a round. For each tool call it validates the input against the tool's zod schema. An invalid or unknown call gets a `tool_result` with `ok: false` and the message, so the model can retry. A read-only call is run, in parallel with the others of its round. A side-effect call is reported as `tool_pending` and not run. When every call has a result, the server starts the next round in the same request. When one is pending, it finishes the automatic calls, emits `done` with `awaiting_approval` and closes the stream.

**Phase two.** The user decides on the card.

- Approve: the browser runs the tool with the model's input and sends the result.
- Edit input: the browser validates the edited JSON with the same schema, runs the tool and sends the result. The model's own `tool_use` block goes back untouched, and the result says what ran.
- Deny: the browser sends an error result, "The user denied this action. Do not try it again unless they ask."

When the last pending call is resolved, the browser sends the whole conversation again. If the user types a new message instead, open approvals are sent as error results ("did not run: the conversation moved on") so the history stays valid.

The browser runs the side-effect tool because the task list lives there. The server never executes one, so a forged request can only put a made-up result into the sender's own context.

## Documents and citations

A citation is `{documentId, documentName, quote, start?, end?, startPage?, endPage?}`. For text, `start` and `end` are a character range and `text.slice(start, end)` equals `quote`. A PDF citation from the model has pages only (counted from 1, both included), and the browser finds the quote on those pages. A citation event attaches to the end of the current text part, so the chip follows the span it supports.

In live mode the request carries `documents`, and their order is the `document_index` the API cites by. The server puts them in the first user turn as document blocks with citations enabled, and maps each streamed `citations_delta` to a `citation` event with the document id. A citation to an index that was not sent is dropped.

In demo mode the server ignores `documents`, and the browser does not send them. A question about documents is answered by the client's own transport, which emits the same events from BM25 ranked passages.

## Interruption and resume

- **Stop.** The browser aborts the fetch. The server aborts the model stream and any running tool. The browser keeps every delta it has and marks the message `stopped`. A running tool becomes `cancelled`.
- **Disconnect.** If the stream ends without `done`, `interrupted` or `error`, the message becomes `interrupted`, shown with a Resume button and not as an error.
- **Resume.** The browser sends the partial answer as an assistant turn, then a user turn asking to continue exactly where it stopped, with `resume: true`. The new text is appended to the same message. A partial tool call whose input never finished is left out.
- **Reload.** A message saved while it was streaming loads as `interrupted`.

## Limits per request

Output tokens are counted across all rounds against `MAX_OUTPUT_TOKENS`. Each round gets what is left as its `max_tokens`, and the request stops with `done: budget` when fewer than 300 remain. `MAX_ROUNDS` caps the loop. A tool call cut off by `max_tokens` is never run.
