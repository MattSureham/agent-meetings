import type { IAgent, AgentHealth, AgentResponse, MeetingPrompt } from '../agent/types.js';
import type { LLMAdapter, ChatMessage } from './types.js';
import type { DebatePhase } from '../meeting/types.js';

export class LLMAgent implements IAgent {
  readonly type = 'llm';

  constructor(
    readonly id: string,
    readonly name: string,
    readonly capabilities: string[],
    private adapter: LLMAdapter
  ) {}

  async respond(prompt: MeetingPrompt): Promise<AgentResponse> {
    const messages: ChatMessage[] = [
      { role: 'system', content: this.buildSystemPrompt(prompt) },
      ...this.transcriptToMessages(prompt.transcript),
      { role: 'user', content: prompt.currentPrompt },
    ];

    const content = await this.adapter.chat(messages);
    return { content };
  }

  async health(): Promise<AgentHealth> {
    try {
      const start = Date.now();
      await this.adapter.chat([{ role: 'user', content: 'ping' }]);
      return { status: 'healthy', lastCheck: Date.now(), latencyMs: Date.now() - start };
    } catch (e) {
      return { status: 'unhealthy', lastCheck: Date.now(), error: String(e) };
    }
  }

  async shutdown(): Promise<void> {
    // nothing to clean up
  }

  private buildSystemPrompt(prompt: MeetingPrompt): string {
    return [
      `You are "${this.name}", an AI agent participating in a structured debate meeting.`,
      `Meeting topic: "${prompt.topic}"`,
      `Background context: ${prompt.background || 'None provided.'}`,
      `Current phase: ${prompt.phase.toUpperCase()}`,
      `Your capabilities: ${this.capabilities.join(', ') || 'general reasoning'}`,
      '',
      this.phaseInstructions(prompt.phase),
      '',
      'Speak naturally as a meeting participant. Be concise but thorough.',
      'Address the other participants by name when responding to their points.',
    ].join('\n');
  }

  private phaseInstructions(phase: DebatePhase): string {
    switch (phase) {
      case 'opening':
        return 'The moderator is introducing the topic. Listen and prepare your initial position.';
      case 'position':
        return 'State your position on the topic clearly. Explain your reasoning and what evidence or principles support your view.';
      case 'rebuttal':
        return 'Respond to the positions stated by other participants. Point out weaknesses, offer counterarguments, and defend your own position where challenged.';
      case 'deliberation':
        return 'Free-form discussion. Raise points you think are important, respond to others, and work toward consensus. If you have nothing new to add, you may pass.';
      case 'voting':
        return 'Cast your vote on the question presented. State your vote clearly and briefly justify it.';
      case 'summary':
        return 'The meeting is concluding. The moderator will summarize.';
      case 'concluded':
        return 'The meeting has concluded.';
      default:
        return 'Participate appropriately for the current meeting phase.';
    }
  }

  private transcriptToMessages(
    transcript: MeetingPrompt['transcript']
  ): ChatMessage[] {
    return transcript.map((msg) => ({
      role: msg.authorId === this.id ? ('assistant' as const) : ('user' as const),
      content: `[${msg.authorName}]: ${msg.content}`,
    }));
  }
}
