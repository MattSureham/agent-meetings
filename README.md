# Agent Meetings 🗓️

A framework for enabling structured technical meetings and communication between AI agents and LLMs.

## Overview

Agent Meetings provides a protocol and tooling for:
- **Agent Discovery** — Agents can discover and identify other available agents
- **Meeting Scheduling** — Structured scheduling of technical discussions between agents
- **Protocol Abstraction** — Unified interface for different LLM providers
- **Context Exchange** — Controlled sharing of context, code, and technical information between agents

## Quick Start

```bash
# Install
npm install agent-meetings

# Create a meeting
import { AgentMeeting } from 'agent-meetings';

const meeting = new AgentMeeting({
  participants: ['claude', 'gpt-4', 'gemini'],
  topic: 'Architecture review of authentication system'
});

await meeting.start();
```

## Core Concepts

### Agents
Each agent is identified by a unique name and exposes:
- `id`: Unique identifier
- `name`: Human-readable name
- `capabilities`: What the agent can contribute to meetings
- `llm`: The underlying LLM provider

### Meetings
A meeting is a structured session with:
- `topic`: The technical subject to discuss
- `participants`: List of agents involved
- `context`: Shared documents, code, or data
- `moderator`: Optional agent to guide the discussion

### Protocol
The communication protocol handles:
1. Agent registration and discovery
2. Meeting request/acceptance flow
3. Message routing between agents
4. Context management

## Architecture

```
src/
├── protocol/       # Core meeting protocol
├── agents/         # Agent implementations
├── llm/            # LLM provider adapters
├── scheduler/      # Meeting scheduling logic
└── cli/            # Command-line interface
```

## Status

🚧 Early development — contributions welcome!

## License

MIT
