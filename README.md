# Assistant Studio

A chat UI for a model with tools. Answers stream in, tool calls show as cards, actions with side effects wait for your approval, and you can stop, resume, regenerate and fork a conversation. An eval suite checks which tools the assistant called and with what input.

Live: https://eg-assistant-studio.vercel.app

The live site has no API key and never calls Claude. It replays sample answers I wrote ahead of time (a banner says so), and it can only answer its example prompts. The tools, the approval step and the task list still run for real. To talk to a real model, run it locally with your own key.

## Run it

Needs Node 24. The app depends on the component library as `file:../ui`, so clone [`eylulg/ui`](https://github.com/eylulg/ui) next to this folder and build it once.

```bash
(cd ../ui && npm install && npm run build)
npm install
npm run relink          # installs ../ui as a copy, run it last after any npm install
cp .env.example .env.local   # optional: add ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000. With a key, requests go to the Anthropic API and cost tokens.

Other commands: `npm test`, `npm run eval` (the eval suite on the saved transcripts, no key), `npm run eval:live` (the same cases against the API, needs a key), `npm run test:e2e`, `npm run record-fixture -- "<prompt>"` (records a real answer, needs a key). The static checks are `typecheck`, `lint`, `format:check` and `knip`.

## What it does

- **Streaming as a state machine.** One reducer turns server events into a message made of text and tool cards. It has a rendering for streaming, waiting for approval, complete, stopped, interrupted and failed.
- **Stop and disconnect differ.** Stop keeps the partial answer and cancels the running tool. A dropped connection shows as interrupted with a Resume button, and Resume sends the partial answer back as context. A tab closed mid-answer comes back resumable.
- **Approval for side effects.** The model runs read-only tools freely. `create_task` waits until you approve, edit its input or deny it. The server is stateless, so the browser runs that tool and sends the result in a second request. The protocol is in [docs/protocol.md](docs/protocol.md).
- **Conversation tree.** Editing an earlier message forks the conversation, regenerating adds a sibling answer, and a version picker steps between them.
- **Documents.** You can attach `.txt`, `.md` and `.pdf` files (5 MB each, 10 files and 400,000 characters of text per conversation). Files are read in the browser and stored in IndexedDB. Answers cite a range, and the number chip opens the source with the cited text highlighted. In demo mode the answer is built in the browser by ranking passages with BM25 and quoting the best ones, with no model, and the document text never leaves the page. With a key, documents go to the API as document blocks with citations. That live path is covered by tests of the request and the stream mapping, but I have not run it against the real API.
- **Insights page** (`/insights`). Usage charts read the conversations saved in your browser: tokens, cache reads, estimated cost, tool calls and latency. Demo replays are labelled and kept apart from real model answers. An evals section shows the latest report in `evals/reports`.

The seven tools (`calculate`, `convert_units`, `get_time`, `search_notes`, `list_tasks`, `lookup_weather`, `create_task`) are local and deterministic. The weather is fixed sample data for eight cities and says so.

## Decisions

- **Replay at the model boundary.** Demo mode replays the events a model would stream, and everything after that is real code. The cost is that the 15 recordings are marked `"source": "authored"`, because I wrote them in the recorded format instead of recording the API. Their token counts are estimates. `npm run record-fixture` replaces one with a real recording.
- **A stateless server.** The browser sends the whole conversation on every request, so stop, resume, fork and approval are all "send it again". The cost is larger request bodies, capped by `MAX_BODY_BYTES`.
- **Cost limits.** Origin check, body size, a model allowlist (`claude-sonnet-5-5`, `claude-opus-5-5`), an output token ceiling and a round limit per request, and a per-IP rate limit. The rate limit is in memory, so each serverless instance counts on its own. Prompt caching is on for the tool definitions and the system prompt, and server-side fallback is on. Costs shown in the app are estimates from list prices.
- **Conversations live in `localStorage`.** Nothing is stored on the server. The browser keeps the 30 most recent conversations, so long tool outputs use up quota.

On every request the model gets the system prompt, the visible branch of the conversation with tool calls and results, and the tool definitions. The task list goes to this app's server so `list_tasks` can read it, and reaches the model only as that tool's result.

## Tests

Vitest covers the reducer, the request builder, the conversation tree, the engine, the two-phase protocol, interruption and resume, the route handler and the tools. Playwright runs the production build in demo mode: ask, approve a tool with edited input, stop, regenerate, fork, resume, reload, plus axe checks in light and dark mode at 375 and 1280 px.

The eval suite has 19 cases. Each runs a prompt through the real store, engine and tools, and checks the tool choice, the shape of the tool input, call order, the answer text, that a citation matches a result the tools returned, and that a denied action leaves nothing behind. With saved transcripts, passing shows the pipeline and the checks work and says nothing about the model. `npm run eval:live` runs the same cases against the API with a spend limit (`EVAL_BUDGET_USD`). CI runs it only when the repository has an `ANTHROPIC_API_KEY` secret.

## Deploy

Vercel, Next.js preset, repository root, with no environment variables. `vercel.json` clones and builds `eylulg/ui` from its main branch during install, so the app uses the latest library code before it is released to npm. Leave `ANTHROPIC_API_KEY` unset so a visit costs nothing.

Every variable is optional (see `.env.example`):

| Variable                    | Default             | Meaning                                            |
| --------------------------- | ------------------- | -------------------------------------------------- |
| `ANTHROPIC_API_KEY`         | empty               | Server side only. Empty means demo mode.           |
| `CHAT_DEFAULT_MODEL`        | `claude-sonnet-5-5` | Model when a request names none.                   |
| `CHAT_EFFORT`               | `medium`            | `low`, `medium`, `high`, `xhigh` or `max`.         |
| `MAX_OUTPUT_TOKENS`         | `4096`              | Output tokens across all rounds of one request.    |
| `MAX_ROUNDS`                | `5`                 | Model rounds per request.                          |
| `MAX_BODY_BYTES`            | `200000`            | Largest request body, not counting documents.      |
| `RATE_LIMIT_REQUESTS`       | `20`                | Requests per IP per window.                        |
| `RATE_LIMIT_WINDOW_SECONDS` | `600`               | Length of the window.                              |
| `DEMO_PACE`                 | `1`                 | Replay speed in demo mode. `0` replays instantly.  |
| `EVAL_BUDGET_USD`           | `0.50`              | Live evals stop starting cases once this is spent. |

[MIT](LICENSE), Eylül Güneş
