import type { MeetingSummary } from './types.js';
import type { LLMAdapter } from '../llm/types.js';
import type { IAgent } from '../agent/types.js';

export class Summarizer {
  private adapter: LLMAdapter | null;

  constructor(adapter: LLMAdapter | null = null) {
    this.adapter = adapter;
  }

  async summarize(
    topic: string,
    context: string,
    transcript: { authorName: string; content: string }[],
    participants: IAgent[]
  ): Promise<MeetingSummary> {
    if (this.adapter) {
      return this.llmSummary(topic, context, transcript, participants);
    }
    return this.fallbackSummary(participants);
  }

  private async llmSummary(
    topic: string,
    context: string,
    transcript: { authorName: string; content: string }[],
    participants: IAgent[]
  ): Promise<MeetingSummary> {
    const transcriptText = transcript
      .map((m) => `[${m.authorName}]: ${m.content}`)
      .join('\n\n');

    const response = await this.adapter!.chat([
      {
        role: 'system',
        content: [
          'You produce structured meeting summaries in JSON format.',
          'Output ONLY valid JSON matching this schema:',
          '{',
          '  "consensus": "string — the main agreement or decision reached",',
          '  "keyPoints": ["string — main arguments and findings"],',
          '  "dissentingViews": ["string — minority or opposing opinions"],',
          '  "actionItems": ["string — concrete follow-up tasks"]',
          '}',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `Topic: ${topic}`,
          `Context: ${context}`,
          `Participants: ${participants.map((p) => p.name).join(', ')}`,
          '',
          'TRANSCRIPT:',
          transcriptText,
          '',
          'Produce the meeting summary as JSON.',
        ].join('\n'),
      },
    ]);

    try {
      const json = JSON.parse(response.replace(/```json\n?|\n?```/g, '').trim());
      return {
        consensus: json.consensus ?? 'No consensus recorded.',
        keyPoints: json.keyPoints ?? [],
        dissentingViews: json.dissentingViews ?? [],
        actionItems: json.actionItems ?? [],
      };
    } catch {
      return {
        consensus: response.slice(0, 500),
        keyPoints: [],
        dissentingViews: [],
        actionItems: [],
      };
    }
  }

  private fallbackSummary(participants: IAgent[]): MeetingSummary {
    return {
      consensus: 'Meeting concluded (no LLM available for automated summary).',
      keyPoints: [],
      dissentingViews: [],
      actionItems: [],
    };
  }

  parseVotes(transcript: { authorName: string; content: string }[]): Record<
    string,
    number
  > {
    const tally: Record<string, number> = { yes: 0, no: 0, abstain: 0 };

    for (const msg of transcript) {
      const content = msg.content.toUpperCase();
      if (content.includes('VOTE: YES') || content.includes('VOTE YES')) {
        tally.yes++;
      } else if (content.includes('VOTE: NO') || content.includes('VOTE NO')) {
        tally.no++;
      } else if (
        content.includes('VOTE: ABSTAIN') ||
        content.includes('VOTE ABSTAIN')
      ) {
        tally.abstain++;
      }
    }

    return tally;
  }
}
