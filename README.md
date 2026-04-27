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

Supported providers: `anthropic`, `openai`, `gemini`, `ollama` (local models).

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
- Optional: one or more LLM API keys (Anthropic, OpenAI, Gemini) or a local Ollama instance

### Setup

```bash
# Clone and install
git clone <repo>
cd agent-meetings
npm install

# Build
npm run build

# Copy and customize the example config
cp meetings.config.example.yml meetings.config.yml
```

Edit `meetings.config.yml` to add your API keys. You can either put them directly in the file (for local dev) or use environment variables:

```yaml
agents:
  - id: claude-sonnet
    name: "Claude Sonnet"
    type: llm
    capabilities: [analysis, reasoning]
    provider: anthropic
    model: claude-sonnet-4-20250514
    apiKey: "${ANTHROPIC_API_KEY}"    # reads from environment
```

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

### Run a meeting

**Terminal 1 — start the server:**
```bash
agent-meetings serve
# Server listening on http://0.0.0.0:4200
```

**Terminal 2 — check what agents are available:**
```bash
agent-meetings list agents
# Agents (2):
#   claude-sonnet — Claude Sonnet [llm]
#   gpt-4 — GPT-4 [llm]
```

**Schedule and run a meeting:**
```bash
agent-meetings schedule \
  -t "Should we migrate from REST to GraphQL for our API?" \
  -a claude-sonnet,gpt-4 \
  -m claude-sonnet
# Meeting scheduled: 3f8a2b1c-...
```

The meeting runs asynchronously on the server. Each agent takes its turns in sequence — you can watch the server logs to see the phases progress.

**View the results:**
```bash
agent-meetings view 3f8a2b1c-...
# Shows: topic, status, full transcript by phase, summary, vote tally
```

**List past meetings:**
```bash
agent-meetings list meetings
agent-meetings list meetings --status concluded
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
| `provider` | `anthropic` \| `openai` \| `gemini` \| `ollama` | Which API to call |
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
agent-meetings serve [options]
  -p, --port <port>        Port to listen on
  -c, --config <path>      Path to config file (default: ./meetings.config.yml)
  -d, --data-dir <path>    Data directory for persistence

agent-meetings schedule -t <topic> -a <agent-ids> [options]
  -t, --topic <topic>      Meeting topic (required)
  -a, --agents <ids>       Comma-separated agent IDs (required)
  -m, --moderator <id>     Agent ID to act as moderator
  -x, --context <text>     Background context (literal text or path to a file)
  -s, --server <url>       Server URL (default: http://localhost:4200)
  --no-auto-start          Schedule without starting immediately

agent-meetings list <resource>
  agents                   List registered agents with capabilities
  meetings                 List all meetings (--status active|concluded|pending|cancelled)

agent-meetings view <meeting-id>
  Shows full transcript, summary, vote tally, and metadata

agent-meetings config validate
  -c, --config <path>      Validate a config file and report errors

agent-meetings config show
  -c, --config <path>      Print effective config (API keys masked)
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
