# Agent Meetings

A framework for running structured technical meetings and debates between AI agents and LLMs.

## How it works

Agent Meetings runs a **long-lived server** that agents register with. When you schedule a meeting, the server picks up the topic and the participants, then runs a structured debate through a fixed sequence of phases. Each phase has a specific purpose and turn-taking rule. The output is a full transcript plus a structured summary.

### Architecture

```
┌──────────────────────────────────┐
│         CLI (client)             │   Talks to the server over HTTP
│  schedule, list, view, config    │   to schedule meetings, list agents, etc.
└──────────────┬───────────────────┘
               │ HTTP (localhost:4200)
┌──────────────┴───────────────────┐
│         Server                   │
│                                  │
│  HTTP routes   WebSocket (/ws)   │   REST API for management
│     │              │             │   WebSocket for protocol agents
│  ┌──┴──────────────┴──┐         │
│  │   AgentRegistry    │         │   Holds all IAgent instances
│  │  ┌──────────────┐  │         │   Boots subprocess + LLM agents from config
│  │  │  IAgent      │  │         │   Accepts protocol agents over WS
│  │  │  IAgent      │  │         │
│  │  │  IAgent ...   │  │         │
│  │  └──────────────┘  │         │
│  └────────┬───────────┘         │
│           │                      │
│  ┌────────┴───────────┐         │
│  │  MeetingEngine     │         │   State machine: phases + turn management
│  │  ┌──────────────┐  │         │   Prompts each agent in sequence
│  │  │  TurnManager │  │         │   Collects transcript, produces summary
│  │  └──────────────┘  │         │
│  └────────┬───────────┘         │
│           │                      │
│  ┌────────┴───────────┐         │
│  │  JsonFileStore      │         │   Persists meetings to data/meetings/<id>.json
│  └────────────────────┘         │
└──────────────────────────────────┘
               ▲
               │ WebSocket (ws://localhost:4200/ws)
┌──────────────┴───────────────────┐
│   External Protocol Agent         │
│   Any process in any language     │
└──────────────────────────────────┘
```

### How agents work

Every participant — CLI tool, LLM API, or remote process — implements the same `IAgent` interface:

```
respond(meetingPrompt) → AgentResponse   // called each turn
health() → AgentHealth                   // status check
shutdown() → void                        // cleanup
```

The server doesn't care how an agent produces its response. It just calls `respond()` on each agent in turn and records what comes back.

#### Browser agents (free chat UIs — no API key needed)

Browser agents use Playwright to control real web chat interfaces. No API key, no billing — you open the free tier of any chat site, log in once in the browser window that pops up, and the session persists. The framework types your prompt, waits for the response, and extracts the text.

```
Turn start
  → Navigate to chat site (e.g., chatgpt.com)
  → Click input box, type the meeting prompt
  → Press Enter
  → Wait for stop button to appear (generation started)
  → Wait for stop button to disappear (generation done)
  → Extract the assistant's response text
  → Return it to the meeting
Turn end
```

**First run**: a Chromium window opens. Log into your accounts (ChatGPT, Claude, Gemini, DeepSeek). The login session is saved in `~/.agent-meetings/browser/<agent-id>/` so you only need to do this once. Subsequent runs reuse the session.

**Sites supported out of the box**: `chatgpt`, `claude`, `gemini`, `deepseek`.

Add a browser agent to your config:

```yaml
agents:
  - id: chatgpt
    name: "ChatGPT"
    type: browser
    capabilities: [general, creative, brainstorming]
    site: chatgpt
    timeoutMs: 120000
```

Run a meeting with free agents only — zero API cost:

```bash
agent-meetings run -t "Design a REST API for a todo app" -a chatgpt,claude-web,gemini-web
```

#### Subprocess agents (CLI tools)

For tools like `claude` or `openclaw`, the server spawns a **new child process per turn**. The full meeting context (topic, background, transcript so far, and the current prompt) is formatted as text. The CLI is invoked with that text as an argument. The server reads stdout and treats it as the agent's response.

```
Turn start
  → Build prompt text from meeting state
  → Spawn: claude -p "{prompt text}" --output-format text
  → Wait for stdout (up to timeoutMs)
  → Record response in transcript
Turn end
```

This per-turn spawning means the agent is stateless between turns — each invocation gets the full transcript as context. It works with any CLI tool that accepts a prompt argument. Timeout is configurable (default 60s); if the subprocess doesn't finish in time, the turn is recorded as a timeout and the meeting moves on.

To add a new CLI agent, add an entry to your config:

```yaml
agents:
  - id: my-tool
    name: "My Tool"
    type: subprocess
    tool: generic
    capabilities: [coding]
    command: my-tool
    args: ["--prompt", "{prompt}"]    # {prompt} is replaced with the full context
    timeoutMs: 120000
```

#### LLM agents (API-based)

For raw LLM APIs (Anthropic, OpenAI, Gemini, Ollama), the server calls the API directly using Node's built-in `fetch`. The meeting context is converted to chat messages (system prompt + conversation history + current turn prompt) and sent to the model.

```
Turn start
  → Build system prompt ("You are Alice, participating in a debate about X...")
  → Convert transcript to user/assistant messages
  → Add current turn prompt
  → POST to API endpoint
  → Return response content
Turn end
```

The system prompt includes the agent's name, capabilities, meeting topic, current phase, and phase-specific instructions (e.g., "State your position clearly" during POSITION, "Respond to others' points" during REBUTTAL).

To add an LLM agent:

```yaml
agents:
  - id: claude-sonnet
    name: "Claude Sonnet"
    type: llm
    capabilities: [analysis, reasoning]
    provider: anthropic
    model: claude-sonnet-4-20250514
    apiKey: "${ANTHROPIC_API_KEY}"     # reads from ANTHROPIC_API_KEY env var
```

Supported providers: `anthropic`, `openai`, `gemini`, `deepseek`, `minimax`, `ollama` (local models).

#### Protocol agents (WebSocket)

For external processes that you want to keep running long-term, they connect to the server over WebSocket at `/ws` and implement a simple JSON protocol:

```
Agent connects to ws://localhost:4200/ws
  → Agent sends: {"type": "register", "id": "...", "name": "...", "capabilities": [...]}
  → Server sends: {"type": "registered", "id": "..."}
  → (periodic) Agent sends: {"type": "heartbeat"}
  → (periodic) Server sends: {"type": "heartbeat_ack"}

When a meeting turn arrives for this agent:
  → Server sends: {"type": "meeting_prompt", "requestId": "...", "meetingId": "...", ...}
  → Agent sends: {"type": "meeting_response", "requestId": "...", "content": "..."}

When another agent speaks:
  → Server broadcasts: {"type": "meeting_update", "meetingId": "...", "message": {...}}
```

This means you can write an agent in any language. It just needs to open a WebSocket, register, and respond to prompts. See the [WebSocket Protocol](#websocket-protocol-for-external-agents) section for the full message spec.

---

### How a meeting works (debate phases)

When a meeting starts, it moves through a fixed sequence of phases. Each phase has a goal and a turn-taking rule.

```
schedule → PENDING → start → OPENING → POSITION → REBUTTAL ─┬→ DELIBERATION ─┬→ VOTING → SUMMARY → CONCLUDED
                   cancel                                      └──────────────────────────┘
```

#### Phase details

**OPENING** — The moderator introduces the topic, lists the participants with their capabilities, and explains the ground rules. Only the moderator speaks.

**POSITION** — Round-robin. Each agent states their position on the topic. One round. Prompt: *"What is your position on [topic]? State your reasoning clearly."*

**REBUTTAL** — Round-robin. Each agent responds to the positions already stated, pointing out weaknesses and defending their own view. Configurable number of rounds (`maxRebuttalRounds`, default 1). Prompt: *"You have heard the positions stated so far. Please offer your rebuttal..."*

**DELIBERATION** — Free-form discussion. Each agent gets one initial turn to raise points. After that, agents that indicated they want to speak more get additional turns from a FIFO queue. Capped at `maxDeliberationTurns` (default 10). Prompt: *"The floor is open for deliberation..."*

**VOTING** — Each agent is asked a structured yes/no question about the emerging consensus. Responses are parsed for "VOTE: YES" / "VOTE: NO" to produce a tally.

**SUMMARY** — The moderator (or a configured LLM) reads the full transcript and produces a structured summary:
- **Consensus** — what was agreed upon
- **Key points** — main arguments and findings
- **Dissenting views** — minority opinions
- **Action items** — concrete follow-up tasks
- **Vote tally** — YES/NO/ABSTAIN counts

**CONCLUDED** — Meeting closed, transcript and summary persisted to disk.

#### Moderator

By default, the system itself acts as moderator (using the configured `defaultModerator` LLM for summaries). You can also designate a specific agent as moderator in the meeting config. If no LLM is available for the moderator, summary output is a simple template with the full transcript appended.

#### Timeouts and failures

Each turn has a configurable timeout (`turnTimeoutMs`, default 60,000ms). If an agent doesn't respond in time, its turn is recorded as `[Agent X did not respond within the time limit]` and the meeting proceeds to the next speaker. If an agent throws an error, it's recorded as `[Agent X encountered an error]`. The meeting never stalls on a single broken agent.

---

## Quick Start

### Prerequisites

- Node.js 18+ (for built-in `fetch` and `crypto`)
- One or more LLM API keys from your preferred provider (see supported providers below)
- **No API key?** Use browser agents — they control free chat UIs (ChatGPT, Claude, Gemini, DeepSeek) through a real browser. Playwright is included. Just log in once.
- **Optional**: CLI-based agents installed if you want builders that can write code:
  - [`claude`](https://docs.anthropic.com/en/docs/claude-code) — Claude Code CLI
  - [`openclaw`](https://github.com/openclaw/openclaw) — OpenClaw agent CLI
  - Any other CLI tool that accepts a prompt argument

### Setup

```bash
git clone <repo>
cd agent-meetings
npm install && npm run build
cp meetings.config.example.yml meetings.config.yml
```

### Define your agents

Edit `meetings.config.yml` and add your agents. API keys go in environment variables — the config reads them with `${VAR}` syntax:

```yaml
agents:
  - id: deepseek
    name: "DeepSeek"
    type: llm
    capabilities: [architecture, planning, coding]
    provider: deepseek
    model: deepseek-chat
    apiKey: "${DEEPSEEK_API_KEY}"

  - id: minimax
    name: "MiniMax"
    type: llm
    capabilities: [brainstorming, creative, design]
    provider: minimax
    model: abab6.5s-chat
    apiKey: "${MINIMAX_API_KEY}"
```

```bash
export DEEPSEEK_API_KEY=sk-...
export MINIMAX_API_KEY=...
```

### Run a meeting (one command)

The `run` command does everything in one shot — loads your config, runs the debate, streams the transcript live to your terminal, and prints the summary at the end. No server to start, no second terminal.

**LLM-only meeting** (thinkers talk through a plan):
```bash
agent-meetings run \
  -t "Plan and spec a new URL shortener SaaS — architecture, stack, and launch strategy" \
  -a deepseek,minimax
```

**Builder meeting** (agents that can actually write code and create files):
```bash
agent-meetings run \
  -t "Build a URL shortener in Next.js with Redis — create the full project" \
  -a claude-code,openclaw \
  -m deepseek
```

In a builder meeting, the subprocess agents (`claude-code`, `openclaw`) are invoked with the full meeting context. They can read the transcript, reason about what was planned, and **produce actual output** — writing files, running commands, scaffolding projects. The LLM agent (`deepseek`) acts as moderator: it reviews the output, spots gaps, and directs next steps.

**Mixed meeting** (thinker plans, builders implement):
```bash
agent-meetings run \
  -t "Design and build a REST API for a todo app — DeepSeek architects, Claude Code and OpenClaw implement" \
  -a deepseek,claude-code,openclaw \
  -m deepseek
```

**Free meeting** (no API keys at all — uses free chat UIs):
```bash
agent-meetings run \
  -t "Plan our team's Q3 roadmap" \
  -a chatgpt,claude-web,gemini-web
```

What you'll see:

```
╔══════════════════════════════════════════════╗
║         AGENT MEETINGS — Live Session        ║
╠══════════════════════════════════════════════╣
║ Topic: Plan and spec a new URL shortener ... ║
╠══════════════════════════════════════════════╣
║ Participants:                                  ║
║   • DeepSeek (llm)                             ║
║   • MiniMax (llm)                              ║
║ Moderator: DeepSeek                            ║
╚══════════════════════════════════════════════╝

── OPENING — topic introduction ─────────────────
  ◆ [16:15:32] Moderator:
    MEETING TOPIC: Plan and spec a new URL shortener...

── POSITION — agents state their views ──────────
  ◇ [16:15:45] DeepSeek:
    For the URL shortener, I recommend a serverless architecture...

  ◇ [16:15:58] MiniMax:
    I think we should consider a Rust-based backend with PostgreSQL...

── REBUTTAL — agents respond to each other ──────
  ◇ [16:16:12] DeepSeek:
    MiniMax raises a good point about Rust, but serverless gives us...

  ◇ [16:16:25] MiniMax:
    The serverless approach has cold start concerns at scale...

  ... (deliberation, voting, summary follow) ...

═══════════════════════════════════════════════
              MEETING SUMMARY
═══════════════════════════════════════════════

Consensus: Use a hybrid approach — serverless API + PostgreSQL...
Key Points:
  • Cloudflare Workers for the redirect layer
  • PostgreSQL for analytics and user management
  • Next.js for the dashboard
  ...
```

### Server mode (multi-meeting, background, WebSocket agents)

If you want a persistent server for multiple meetings or external protocol agents:

```bash
# Terminal 1
agent-meetings serve

# Terminal 2
agent-meetings schedule -t "Architecture review" -a deepseek,minimax
agent-meetings list meetings
agent-meetings view <id>
```

---

## Configuration Reference

Full annotated example at [meetings.config.example.yml](meetings.config.example.yml).

### `server`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `port` | number | 4200 | HTTP + WebSocket port |
| `host` | string | "0.0.0.0" | Bind address |
| `dataDir` | string | "./data" | Where meeting files and agent state are saved |

### `agents` (array)

Common fields for all agent types:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (used in `--agents` flag) |
| `name` | string | Display name (appears in transcript) |
| `type` | `subprocess` \| `llm` | Agent type |
| `capabilities` | string[] | Skills/topics this agent can contribute to |

Subprocess-specific fields:

| Field | Type | Description |
|-------|------|-------------|
| `command` | string | CLI command to spawn (e.g., `claude`) |
| `args` | string[] | CLI arguments (use `{prompt}` as placeholder for meeting context) |
| `env` | object | Extra environment variables |
| `cwd` | string | Working directory |
| `timeoutMs` | number | Per-turn timeout in ms (default: 60000) |

LLM-specific fields:

| Field | Type | Description |
|-------|------|-------------|
| `provider` | `anthropic` \| `openai` \| `gemini` \| `deepseek` \| `minimax` \| `ollama` | Which API to call |
| `model` | string | Model name (e.g., `claude-sonnet-4-20250514`, `gpt-4o`) |
| `apiKey` | string | API key (use `${ENV_VAR}` for environment variable) |
| `endpoint` | string | Custom endpoint URL (only needed for Ollama, defaults to `http://127.0.0.1:11434`) |

### `meetings`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `turnTimeoutMs` | number | 60000 | Max time an agent has to respond to a turn |
| `maxRebuttalRounds` | number | 1 | How many rounds of rebuttal before deliberation |
| `maxDeliberationTurns` | number | 10 | Max total turns during the deliberation phase |
| `defaultModerator` | string | — | Agent ID to use as moderator if none specified in the meeting |

---

## CLI Reference

```
agent-meetings run -t <topic> -a <agent-ids> [options]
  One-shot command — loads config, runs the meeting, streams transcript live.
  -t, --topic <topic>          Meeting topic (required)
  -a, --agents <ids>           Comma-separated agent IDs (required)
  -m, --moderator <id>         Agent ID to act as moderator
  -x, --context <text>         Background context (text or path to a file)
  -c, --config <path>          Path to config file (default: ./meetings.config.yml)
  --turn-timeout <ms>          Turn timeout in ms (default: 60000)
  --rebuttal-rounds <n>        Max rebuttal rounds (default: 1)
  --deliberation-turns <n>     Max deliberation turns (default: 10)
  --no-stream                  Only show summary, not live transcript

agent-meetings serve [options]
  Start the persistent server (for multiple meetings, WS agents).
  -p, --port <port>            Port to listen on
  -c, --config <path>          Path to config file (default: ./meetings.config.yml)
  -d, --data-dir <path>        Data directory for persistence

agent-meetings schedule -t <topic> -a <agent-ids> [options]
  Schedule a meeting on a running server.
  -t, --topic <topic>          Meeting topic (required)
  -a, --agents <ids>           Comma-separated agent IDs (required)
  -m, --moderator <id>         Agent ID to act as moderator
  -x, --context <text>         Background context (literal text or path to a file)
  -s, --server <url>           Server URL (default: http://localhost:4200)
  --no-auto-start              Schedule without starting immediately

agent-meetings list <resource>
  agents                       List registered agents with capabilities
  meetings                     List all meetings (--status active|concluded|pending|cancelled)

agent-meetings view <meeting-id>
  Shows full transcript, summary, vote tally, and metadata

agent-meetings config validate
  -c, --config <path>          Validate a config file and report errors

agent-meetings config show
  -c, --config <path>          Print effective config (API keys masked)
```

---

## WebSocket Protocol (for external agents)

Connect to `ws://<host>:<port>/ws`.

### Messages from agent to server

**register** — sent once on connect (within 10 seconds, or the connection is closed):
```json
{
  "type": "register",
  "id": "my-agent",
  "name": "My Agent",
  "capabilities": ["coding", "architecture"]
}
```

**heartbeat** — sent periodically to keep the connection alive:
```json
{"type": "heartbeat"}
```

**meeting_response** — sent in response to a `meeting_prompt`:
```json
{
  "type": "meeting_response",
  "requestId": "same-as-in-the-prompt",
  "content": "My position on this topic is..."
}
```

### Messages from server to agent

**registered** — confirms registration:
```json
{"type": "registered", "id": "my-agent"}
```

**heartbeat_ack** — response to heartbeat:
```json
{"type": "heartbeat_ack"}
```

**meeting_prompt** — a turn for this agent to speak:
```json
{
  "type": "meeting_prompt",
  "requestId": "uuid",
  "meetingId": "uuid",
  "phase": "position",
  "topic": "Should we adopt microservices?",
  "background": "We are a team of 10...",
  "transcript": [
    {
      "id": "msg-uuid",
      "authorId": "other-agent",
      "authorName": "Claude Sonnet",
      "content": "I think...",
      "phase": "position",
      "timestamp": 1714000000000
    }
  ],
  "speakingOrder": ["my-agent", "other-agent"],
  "currentPrompt": "What is your position on this topic?"
}
```

**meeting_update** — broadcast when another agent speaks:
```json
{
  "type": "meeting_update",
  "meetingId": "uuid",
  "message": {
    "id": "msg-uuid",
    "authorName": "Claude Sonnet",
    "content": "I think..."
  }
}
```

**error** — sent if the server rejects a message:
```json
{"type": "error", "message": "Registration requires id and name"}
```

---

## Programmatic Use

```typescript
import {
  createServer,
  MeetingEngine,
  LLMAgent,
  AnthropicAdapter,
  SubprocessAgent,
} from 'agent-meetings';

// ── Start the full server ──────────────────────────────────
const server = await createServer('./meetings.config.yml');
await server.start();
// Server running, agents booted from config, ready for CLI and WS

// ── Or run a meeting directly (no server needed) ───────────
const alice = new LLMAgent(
  'alice',
  'Alice',
  ['architecture', 'typescript'],
  new AnthropicAdapter(process.env.ANTHROPIC_API_KEY!)
);

const bob = new LLMAgent(
  'bob',
  'Bob',
  ['python', 'data-engineering'],
  new AnthropicAdapter(process.env.ANTHROPIC_API_KEY!)
);

const meeting = new MeetingEngine({
  topic: 'Monolith vs. microservices for a 10-person team',
  context: 'We are building a SaaS product with a monolith and considering a split.',
  participants: [alice, bob],
  turnTimeoutMs: 60_000,
  maxRebuttalRounds: 1,
  maxDeliberationTurns: 10,
});

await meeting.start();

// meeting.transcript is the full Message[]
// meeting.summary has consensus, keyPoints, dissentingViews, actionItems, voteTally
// meeting.toStoredMeeting() serializes everything for persistence

console.log(meeting.summary?.consensus);
```

---

## Data Persistence

All data lives in the `dataDir` directory (default `./data`):

```
data/
├── agents.json                # Array of registered agents with health status
└── meetings/
    ├── <uuid-1>.json          # Full meeting record (topic, transcript, summary, phase timeline)
    ├── <uuid-2>.json
    └── ...
```

Files are human-readable JSON. You can inspect them directly or query them through the server API / CLI.

---

## License

MIT
