# Streaming and tool protocol

One endpoint, `POST /api/chat`, answers with server-sent events. The server keeps no state between requests: the browser owns the conversation and sends all of it every time. That keeps the server simple (no session store, nothing to expire) and makes interruption, resume, forking and approval ordinary cases of "send the conversation again".

## Request

```jsonc
{
  "model": "claude-sonnet-5-5", // allowlist: claude-sonnet-5-5, claude-opus-5-5
  "system": "optional, up to 4000 characters",
  "messages": [/* wire messages, see below */],
  "tasks": [/* the client's task list, at most 100 */],
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

## Interruption and resume

- **Stop.** The browser aborts the fetch. The server sees the request signal abort, aborts the model stream and any running tool, and stops writing. The browser keeps every delta it already has and marks the message `stopped`. A tool that was streaming or running becomes `cancelled`.
- **Disconnect.** If the stream ends without `done`, `interrupted` or `error`, or a read fails half way, the message becomes `interrupted`. This is shown as a state with a Resume button, not as an error. A dropped connection to the model produces an explicit `interrupted` event.
- **Resume.** The browser sends the conversation with the partial answer as an assistant turn, followed by a user turn asking to continue exactly where it stopped, and `resume: true`. The new text is appended to the same message and its round is recorded in `resumes`, so later requests replay the same history. A partial tool call whose input never finished is left out of the history, because the model never completed it.
- **Reload.** A message saved while it was streaming loads as `interrupted`, so a closed tab is a resumable state too.

## Limits per request

Output tokens are counted across all rounds against `MAX_OUTPUT_TOKENS`. Each round gets only what is left as its `max_tokens`, and the request stops with `done: budget` when fewer than 300 tokens remain. `MAX_ROUNDS` caps the loop. A tool call cut off by `max_tokens` is never run.
