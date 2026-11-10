# Assistant Studio

A streaming assistant UI built to get the states around a model right: tokens that stream in, tool calls that render as cards, actions that wait for approval, answers you can stop, resume, regenerate and fork, and an eval suite that checks what the assistant actually did. It is part of [Eylül Güneş](https://github.com/eylulg)'s projects and uses the shared design system, [`@eylulg/ui`](https://github.com/eylulg/ui) with its `assistant` theme variant.

## What it proves

This project exists to show AI-native product UI craft, not a chat box with a model behind it.

- **Streaming is a state machine, not a string.** One pure reducer turns server events into a message made of ordered parts (text, tool cards), tested on its own. Every state a user can see has its own rendering: streaming, waiting for approval, complete, stopped, interrupted, failed.
- **Stop and disconnect are different things.** Stop keeps the partial answer and cancels the running tool. A dropped connection is shown as an interruption with a Resume button, never as an error. Resume sends the partial answer back as context. Closing the tab mid-answer comes back as a resumable message.
- **Actions with side effects ask first.** The model can read freely, but `create_task` does not run until the user approves it, edits its input, or denies it. The protocol that makes this work with a stateless server is in [docs/protocol.md](./docs/protocol.md).
- **A conversation is a tree.** Editing an earlier message forks the conversation, regenerating adds a sibling answer, and a version picker steps between branches without losing any.
- **Honest numbers.** Tokens, cache reads and an estimated cost for every answer, labelled as estimates, and a demo mode that says what it is.
- **Evals are part of the product.** A fixture suite replays recorded model streams through the real engine, store and tools and asserts tool choice, tool input shape and answer constraints. The same cases run against the real API when a key is set.

## Run it

```bash
# once: the component library is linked from the folder next to this one
cd ../ui && npm install && npm run build && cd -

npm install
npm run relink          # installs ../ui as a copy, so there is a single copy of React
npm run dev             # http://localhost:3000
```

`@eylulg/ui` is installed with `--install-links`, which makes a snapshot. After a library rebuild run `npm run relink` here, and run it last after any other `npm install`. Details in the library's [consuming guide](../ui/docs/consuming.md).

Without `ANTHROPIC_API_KEY` the app starts in demo mode. With one in `.env.local` it talks to the real API.

| Script                                              | What it does                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm run dev`                                       | Development server.                                                                                   |
| `npm test`                                          | Unit and component tests (Vitest, Testing Library).                                                   |
| `npm run eval`                                      | The eval suite on recorded transcripts, with a table report. No key, no network.                      |
| `npm run eval:live`                                 | The same cases against the real API. Skipped without `ANTHROPIC_API_KEY`. Stops at `EVAL_BUDGET_USD`. |
| `npm run record-fixture`                            | Records a real answer for a prompt into `evals/transcripts`. Needs a key and spends tokens.           |
| `npm run test:e2e`                                  | One Playwright run in demo mode with an axe check in light and dark, at 375 and 1280 pixels.          |
| `npm run typecheck`, `lint`, `format:check`, `knip` | The static gates. ESLint 9 flat config with zero warnings, Prettier, unused code and dependencies.    |
| `npm run build`                                     | Production build.                                                                                     |

## Environment variables

Copy `.env.example` to `.env.local`. Every value is optional.

| Variable                    | Default             | Meaning                                                                                      |
| --------------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`         | empty               | Server side only. Empty means demo mode.                                                     |
| `CHAT_DEFAULT_MODEL`        | `claude-sonnet-5-5` | Used when a request names none. The model list is `claude-sonnet-5-5` and `claude-opus-5-5`. |
| `CHAT_EFFORT`               | `medium`            | Effort for chat requests: `low`, `medium`, `high`, `xhigh` or `max`.                         |
| `MAX_OUTPUT_TOKENS`         | `4096`              | Output tokens across all rounds of one request.                                              |
| `MAX_ROUNDS`                | `5`                 | Model rounds per request (each round of tool results needs another model call).              |
| `MAX_BODY_BYTES`            | `200000`            | Largest request body.                                                                        |
| `RATE_LIMIT_REQUESTS`       | `20`                | Requests per IP address per window.                                                          |
| `RATE_LIMIT_WINDOW_SECONDS` | `600`               | Length of the window.                                                                        |
| `DEMO_PACE`                 | `1`                 | Replay speed in demo mode. `0` replays instantly.                                            |
| `EVAL_BUDGET_USD`           | `0.50`              | Live evals stop starting new cases once the estimated spend passes this.                     |

## Demo mode

With no API key the server replays recorded model streams from [`evals/transcripts`](./evals/transcripts) and a banner says so. Replay happens at the model boundary: the recorded events are exactly what the model streamed (text deltas, tool calls with streamed input, usage), and everything after that is real. The tools run again, the approval step is real, the task list is real, and `get_time` uses a frozen clock so the recorded answer matches. The recordings include a tool chain with an approval, parallel calls, a failing tool, a denied task and an interruption (the connection drops partway through "Explain how server-sent events work" so you can try Resume).

Replay matches the last message you sent against the recorded prompts (an exact match after normalising, then a close match). Anything else gets a short message listing the example prompts, so the demo never pretends to answer what it cannot.

**About the shipped recordings.** The 13 transcripts in this repository are marked `"source": "authored"`: they were written in the recorded format, with tool results computed by the real tools, because no API key was available when the project was built. Their token counts are estimates. Re-record them with a key: `ANTHROPIC_API_KEY=... npm run record-fixture -- "What is 18% of 2,450, plus 75?"`. A recording from the real API is marked `"source": "recorded"`, and a prompt that needs approval is recorded twice, to capture what the model says after a denial. The eval cases are keyed by prompt, so a re-recorded transcript replaces the authored one without other changes.

The `list-tasks` recording assumes a task list that holds only the sample passport task, so in demo mode its answer is only right after the "renew my passport" example.

## How a turn works

```
browser (zustand store)                 POST /api/chat                          model
conversation tree, tasks, settings      stateless, server-sent events

 send, regenerate, edit, resume  ─────▶ same origin, body cap, zod, model
                                        allowlist, per-IP rate limit
                                              │
                                              ▼
                                        engine: model round  ───────────────▶  Claude (streaming,
                                              │  text, tool_start, tool_input        cached system
                                              │                                      prompt and tools,
                                              ▼                                      eager tool input)
                                        validate tool input (zod)
                                        run tools without side effects, in parallel
                                        side-effect tool: report as pending, stop
 reducer: events ▶ message parts  ◀───  tool_call, tool_pending, tool_result, usage, done
 approval card: Approve / Edit / Deny
 browser runs the side-effect tool ─▶  second request with the result, next round
```

The full event list, the two-phase protocol, and the semantics of Stop, disconnect and Resume are in [docs/protocol.md](./docs/protocol.md).

Module map: `src/lib/protocol.ts` (zod schemas for requests and events), `src/lib/engine` (the loop, the Anthropic backend, the replay backend), `src/lib/tools` (the seven tools), `src/lib/chat` (reducer, tree, wire builder, persistence, export), `src/store` (zustand store and the turn runner), `src/components` (UI), `evals` (cases, harness, checks, report).

### Tools

All tools are local and deterministic, so the demo is honest. Their definitions, including the JSON Schema the model sees, are generated from the same zod schemas that validate each call.

| Tool             | Side effect | What it does                                                                                                      |
| ---------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `calculate`      | no          | Evaluates arithmetic with a hand written parser (no `eval`): `+ - * / % ^`, parentheses, a few functions.         |
| `convert_units`  | no          | Length, mass, volume, speed, time, data size and temperature. A mismatch such as km to cups is an error result.   |
| `get_time`       | no          | Date and time in an IANA time zone. Says when the clock is frozen (demo mode).                                    |
| `search_notes`   | no          | Full-text search with field weighting over a bundled sample notebook of 30 notes. The answer cites `[note-06]`.   |
| `list_tasks`     | no          | Reads the task list the browser sent with the request.                                                            |
| `lookup_weather` | no          | Fixture data for eight cities, always labelled as sample data. It waits half a second to resemble a network call. |
| `create_task`    | yes         | Adds a task to the side panel. Waits for Approve, Edit input or Deny.                                             |

### Markdown

Answers render as Markdown with GitHub tables, and fenced code goes through the library's `CodeBlock` with a copy button. Raw HTML is never rendered. Headings in an answer render as bold paragraphs so they cannot break the page's heading order.

## Eval design

An eval case is a prompt plus expectations (`evals/cases.ts`). The harness (`evals/harness.ts`) runs it through the real client store and the real engine in process, so the reducer, the wire builder, the approval flow and the tools are exercised exactly as in the app. Only the model backend changes between modes:

- `npm run eval` replays the recorded transcript for the prompt (`evals/transcripts`).
- `npm run eval:live` calls the real API with the same cases, on the real clock, with a per-case output cap.

A simulated user approves or denies at approval steps (`approval` on the case). Checks (`evals/checks.ts`):

| Check              | Asserts                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Tool choice        | Each expected tool was called, matched to a different call, ended in the expected state, and nothing else ran. |
| Tool input shape   | The call's input satisfies a zod schema written for the case (for example `due` is `2026-12-01`).              |
| Order and parallel | Calls came in the expected order, and at least N calls came from one round.                                    |
| Answer text        | Contains and does not contain strings or patterns, and stays under a maximum length.                           |
| Grounded citation  | The answer cites `[note-06]` and a `search_notes` result in the same run actually returned that note.          |
| Side effects       | The task list has the expected number of tasks at the end, so a denied action leaves nothing behind.           |

The checks themselves are tested (`evals/checks.eval.ts`) so a broken assertion cannot quietly pass everything. The live run has a budget guard: it adds up the estimated cost of each case and skips the rest, marked as skipped in the report, once `EVAL_BUDGET_USD` is spent. Without a key it skips everything and exits successfully, which is why CI can run it only when the `ANTHROPIC_API_KEY` secret exists.

Latest fixture run (`npm run eval`):

```
case                     result  tools                                     checks  chars  tokens  est. cost
-----------------------  ------  ----------------------------------------  ------  -----  ------  ---------
calc-basic               pass    calculate                                 4/4     78     2497    $0.0011
convert-units-parallel   pass    convert_units, convert_units              7/7     93     2521    $0.0013
time-zone                pass    get_time                                  5/5     141    2512    $0.0012
notes-search-cites       pass    search_notes                              5/5     316    2566    $0.0018
create-task-approved     pass    create_task                               5/5     126    2519    $0.0013
create-task-denied       pass    create_task                               6/6     166    2530    $0.0014
list-tasks               pass    list_tasks                                5/5     74     2492    $0.0010
weather-sample-parallel  pass    lookup_weather, lookup_weather            8/8     216    2546    $0.0016
parallel-mixed           pass    lookup_weather, lookup_weather, get_time  8/8     226    2567    $0.0018
no-tool-needed           pass    none                                      3/3     120    1262    $0.0007
markdown-code            pass    none                                      3/3     481    1363    $0.0017
chain-search-then-task   pass    search_notes, create_task                 7/7     225    3794    $0.0021
tool-error-recovery      pass    convert_units                             6/6     199    2531    $0.0014

13 passed, 0 failed, 0 skipped.
```

Passing on authored transcripts shows that the pipeline and the assertions work. It says nothing yet about the model. That is what `npm run eval:live` is for.

## What is sent to the model

On every request: the system prompt (the default, or yours from Settings), the conversation of the visible branch (your messages, the assistant's earlier text, tool calls and their results), and the tool definitions. Reasoning blocks are sent back only while a turn is still running. The task list is sent to this app's server so `list_tasks` can read it, and reaches the model only through that tool's result. The sample notebook lives on the server and reaches the model only as search results. Nothing else leaves the browser, and nothing is stored on the server. Conversations and tasks stay in `localStorage`.

## Cost controls

| Control          | How                                                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin check     | A cross-site POST is refused with 403.                                                                                                                                                                                        |
| Body cap         | `MAX_BODY_BYTES`, checked on the declared length and again on the actual body. A request also needs a valid schema and at most 120 messages.                                                                                  |
| Rate limit       | Per IP address, `RATE_LIMIT_REQUESTS` per window, in memory (per server instance on a serverless host), with `Retry-After`.                                                                                                   |
| Model allowlist  | Only `claude-sonnet-5-5` and `claude-opus-5-5`. Anything else is a 400.                                                                                                                                                       |
| Output ceiling   | `MAX_OUTPUT_TOKENS` across the whole request. Each round gets what is left; the request ends with `budget` when too little remains.                                                                                           |
| Round limit      | `MAX_ROUNDS` bounds the tool loop. A tool call cut off by the token limit is never run.                                                                                                                                       |
| Prompt caching   | Cache breakpoints on the last tool definition and on the system prompt, so the tools and system prompt are one cached prefix. The readout shows cache reads. A prefix below the model's minimum cacheable size is not cached. |
| Effort           | `medium` by default, which keeps latency and spend down. Raise it with `CHAT_EFFORT`.                                                                                                                                         |
| Fallback         | Server-side fallback is on (`fallbacks: "default"`), so a policy refusal is retried on the recommended model instead of ending the answer.                                                                                    |
| Live eval budget | `EVAL_BUDGET_USD`, and an output cap per case.                                                                                                                                                                                |

Costs shown in the app use list prices (Sonnet 5.5 at $2 input and $10 output per million tokens, Opus 5.5 at $4 and $20, cache reads at a tenth of input, cache writes at 1.25 times) and are estimates.

## Models

The model picker offers Claude Sonnet 5.5 (default, for the public demo) and Claude Opus 5.5 (the thorough option). Thinking is left on its default, which is adaptive. Reasoning blocks come back from the API, are stored on the message, and are returned unchanged while the turn is running, as tool use with thinking requires. They are dropped from earlier turns.

## Tests

Tests follow the shared engineering standards: behaviours, not props. The reducer, the wire builder, the conversation tree, persistence, the engine and the two-phase protocol, interruption and resume, branching, the route handler (origin, size, rate limit, allowlist, request shape sent to the SDK), the Anthropic backend mapping, the tools, and the Studio screen with a real route behind a stubbed `fetch`. One Playwright run in demo mode covers ask, tool approval with an edited input, Stop, Regenerate, fork, interruption and Resume, and reload, and an axe check in light and dark at 375 and 1280 pixels.

## Accessibility

Everything works by keyboard (Enter sends, Shift plus Enter adds a line, Escape stops a streaming answer). After Approve, Deny, Resume, Regenerate or saving an edit the control that had focus is gone, so focus moves to a chosen element (the tool card, or the message box). A polite live region announces state changes (answering, waiting for approval, complete, stopped, interrupted) without reading the stream token by token. The conversation region is keyboard scrollable, and the layout holds at 375 pixels with the conversation list and tasks in drawers.

## Known limits

- The rate limit is in memory, so on a serverless host each instance counts for itself.
- The demo can only answer its recorded prompts.
- Markdown is parsed again on each batch of deltas. Updates are batched per animation frame, and answers are short, but a very long answer would want incremental rendering.
- A conversation is stored whole in `localStorage` (the 30 most recent are kept), so very long tool outputs use quota.
- The weather tool returns fixture data on purpose.

## License

[MIT](./LICENSE) © Eylül Güneş
