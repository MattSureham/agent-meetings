import type { IAgent } from '../agent/types.js';
import type { LLMAdapter } from '../llm/types.js';
import { DebatePhase } from './types.js';

export class Moderator {
  private adapter: LLMAdapter | null;

  constructor(adapter: LLMAdapter | null = null) {
    this.adapter = adapter;
  }

  systemModeratorId = '__system_moderator__';
  systemModeratorName = 'Moderator';

  buildOpeningPrompt(topic: string, context: string, agents: IAgent[]): string {
    const participantList = agents.map((a) => `- ${a.name} (${a.id}): ${a.capabilities.join(', ')}`).join('\n');

    return [
      '========================================',
      `MEETING TOPIC: ${topic}`,
      '========================================',
      context ? `\nBACKGROUND CONTEXT:\n${context}\n` : '',
      'PARTICIPANTS:',
      participantList,
      '',
      'GROUND RULES:',
      '1. Each participant will state their position in round-robin order.',
      '2. Participants may then offer rebuttals to other positions.',
      '3. Free-form deliberation follows, with raised-hand turn-taking.',
      '4. A vote may be called to reach consensus.',
      '5. The meeting concludes with a structured summary.',
      '',
      'We now begin with position statements.',
      `Each participant, please state your position on: "${topic}"`,
    ].join('\n');
  }

  buildPositionPrompt(topic: string, agentName: string): string {
    return `What is your position on "${topic}"? State your reasoning clearly.`;
  }

  buildRebuttalPrompt(topic: string, agentName: string): string {
    return `You have heard the positions stated so far. Please offer your rebuttal — respond to specific points made by other participants and defend your own position. Topic: "${topic}"`;
  }

  buildDeliberationPrompt(topic: string, agentName: string): string {
    return `The floor is open for deliberation on "${topic}". Raise points you think are important, respond to others, and work toward consensus. If you have nothing new to add, you may pass.`;
  }

  buildVotingPrompt(topic: string, question: string): string {
    return `VOTE: Regarding "${topic}" — ${question} Please respond with VOTE: YES or VOTE: NO and a brief justification.`;
  }

  async buildSummaryPrompt(
    topic: string,
    transcript: string,
    agents: IAgent[]
  ): Promise<string> {
    if (this.adapter) {
      return this.buildLLMSummary(topic, transcript, agents);
    }
    return this.buildTemplateSummary(topic, transcript, agents);
  }

  private async buildLLMSummary(
    topic: string,
    transcript: string,
    agents: IAgent[]
  ): Promise<string> {
    const participantNames = agents.map((a) => a.name).join(', ');
    const systemPrompt = `You are a meeting moderator synthesizing the results of a structured debate.
Produce a meeting summary with these sections:
1. CONSENSUS: What was agreed upon?
2. KEY POINTS: The main arguments and findings
3. DISSENTING VIEWS: Minority opinions
4. ACTION ITEMS: Follow-up tasks

Format each section clearly. Be concise.`;

    const summary = await this.adapter!.chat([
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Topic: ${topic}\nParticipants: ${participantNames}\n\nTranscript:\n${transcript}\n\nProduce the meeting summary.`,
      },
    ]);

    return summary;
  }

  private buildTemplateSummary(
    topic: string,
    transcript: string,
    agents: IAgent[]
  ): string {
    return [
      `=== MEETING SUMMARY ===`,
      `Topic: ${topic}`,
      `Participants: ${agents.map((a) => a.name).join(', ')}`,
      '',
      `CONSENSUS: [No LLM available for summary generation]`,
      `KEY POINTS: [See transcript below]`,
      `DISSENTING VIEWS: [See transcript below]`,
      `ACTION ITEMS: [None recorded]`,
      '',
      `=== FULL TRANSCRIPT ===`,
      transcript,
    ].join('\n');
  }
}
