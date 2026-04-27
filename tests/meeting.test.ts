import { describe, it, expect } from 'vitest';
import { MeetingEngine } from '../src/meeting/engine.js';
import type { IAgent, AgentHealth, AgentResponse, MeetingPrompt } from '../src/agent/types.js';

class MockAgent implements IAgent {
  readonly type = 'llm';
  private responses: string[];
  private idx = 0;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly capabilities: string[],
    responses?: string[]
  ) {
    this.responses = responses ?? [this.name + ' responds.'];
  }

  async respond(_prompt: MeetingPrompt): Promise<AgentResponse> {
    const content = this.responses[this.idx % this.responses.length];
    this.idx++;
    return { content };
  }

  async health(): Promise<AgentHealth> {
    return { status: 'healthy', lastCheck: Date.now() };
  }

  async shutdown(): Promise<void> {}
}

describe('MeetingEngine', () => {
  it('runs a complete meeting through all phases', async () => {
    const agents = [
      new MockAgent('agent-1', 'Alice', ['typescript', 'architecture']),
      new MockAgent('agent-2', 'Bob', ['python', 'data-science']),
      new MockAgent('agent-3', 'Carol', ['security', 'infra']),
    ];

    const engine = new MeetingEngine({
      topic: 'Should we adopt microservices?',
      context: 'We are a team of 10 engineers building a SaaS product.',
      participants: agents,
    });

    await engine.start();

    expect(engine.status).toBe('concluded');
    expect(engine.transcript.length).toBeGreaterThan(0);
    expect(engine.summary).not.toBeNull();
    expect(engine.phaseTimeline.length).toBeGreaterThan(0);

    // Verify phases were entered
    const phases = engine.phaseTimeline.map((p) => p.phase);
    expect(phases).toContain('opening');
    expect(phases).toContain('position');
    expect(phases).toContain('rebuttal');
    expect(phases).toContain('summary');
    expect(phases).toContain('concluded');
  });

  it('handles cancellation', () => {
    const agents = [new MockAgent('agent-1', 'Alice', [])];
    const engine = new MeetingEngine({
      topic: 'Test',
      context: '',
      participants: agents,
    });

    engine.cancel();
    expect(engine.status).toBe('cancelled');
  });

  it('persists to StoredMeeting format', async () => {
    const agents = [new MockAgent('agent-1', 'Alice', ['testing'])];
    const engine = new MeetingEngine({
      topic: 'Test meeting',
      context: 'Some context',
      participants: agents,
    });

    await engine.start();

    const stored = engine.toStoredMeeting();
    expect(stored.id).toBe(engine.id);
    expect(stored.topic).toBe('Test meeting');
    expect(stored.context).toBe('Some context');
    expect(stored.status).toBe('concluded');
    expect(stored.participantIds).toEqual(['agent-1']);
    expect(stored.transcript.length).toBeGreaterThan(0);
    expect(stored.summary).not.toBeNull();
    expect(stored.createdAt).toBeGreaterThan(0);
    expect(stored.concludedAt).toBeGreaterThan(0);
  });

  it('handles agent timeout gracefully', async () => {
    class SlowAgent implements IAgent {
      readonly type = 'llm';
      constructor(
        readonly id: string,
        readonly name: string,
        readonly capabilities: string[]
      ) {}
      async respond(_prompt: MeetingPrompt): Promise<AgentResponse> {
        return new Promise(() => {}); // never resolves
      }
      async health(): Promise<AgentHealth> {
        return { status: 'healthy', lastCheck: Date.now() };
      }
      async shutdown(): Promise<void> {}
    }

    const agents = [new SlowAgent('slow-1', 'Slow', [])];
    const engine = new MeetingEngine({
      topic: 'Test',
      context: '',
      participants: agents,
      turnTimeoutMs: 100,
      maxDeliberationTurns: 1,
      maxRebuttalRounds: 0,
    });

    expect(engine.status).toBe('pending');
  });

  it('enforces maxTotalTurns and ends with turn_limit reason', async () => {
    const agents = [
      new MockAgent('a1', 'Alice', ['general']),
      new MockAgent('a2', 'Bob', ['general']),
      new MockAgent('a3', 'Carol', ['general']),
    ];

    const engine = new MeetingEngine({
      topic: 'Test turn limits',
      context: '',
      participants: agents,
      maxTotalTurns: 3,      // very tight limit — 3 turns means only opening + 2 positions
      maxRebuttalRounds: 0,
      maxDeliberationTurns: 0,
    });

    await engine.start();

    // The meeting should have concluded, even though it didn't finish all phases
    expect(engine.status).toBe('concluded');
    expect(engine.reasonEnded).toBe('turn_limit');
    expect(engine.totalTurns).toBeGreaterThanOrEqual(3);
    expect(engine.summary).not.toBeNull();
    expect(engine.transcript.length).toBeGreaterThan(0);
  });
});
