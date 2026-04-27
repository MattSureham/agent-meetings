import { randomUUID } from 'node:crypto';
import type { IAgent, TranscriptMessage } from '../agent/types.js';
import type { LLMAdapter } from '../llm/types.js';
import {
  DebatePhase,
  PHASE_TRANSITIONS,
  type MeetingStatus,
  type Message,
  type PhaseTransition,
  type MeetingSummary,
  type StoredMeeting,
} from './types.js';
import { TurnManager } from './turn-manager.js';
import { Moderator } from './moderator.js';
import { Summarizer } from './summarizer.js';

export interface MeetingConfig {
  topic: string;
  context: string;
  participants: IAgent[];
  moderatorId?: string;
  turnTimeoutMs?: number;
  maxRebuttalRounds?: number;
  maxDeliberationTurns?: number;
  maxTotalTurns?: number;
  defaultLLM?: LLMAdapter;
}

export class MeetingEngine {
  readonly id: string;
  readonly topic: string;
  readonly context: string;
  readonly participantIds: string[];
  readonly moderatorId: string;

  status: MeetingStatus = 'pending';
  currentPhase: DebatePhase = DebatePhase.OPENING;
  transcript: Message[] = [];
  phaseTimeline: PhaseTransition[] = [];
  summary: MeetingSummary | null = null;
  createdAt: number;
  concludedAt: number | null = null;

  private agents: Map<string, IAgent>;
  private turnManager: TurnManager;
  private moderator: Moderator;
  private summarizer: Summarizer;
  private turnTimeoutMs: number;
  private maxRebuttalRounds: number;
  private maxDeliberationTurns: number;
  private maxTotalTurns: number;
  private aborted = false;
  private turnLimitReached = false;
  private totalTurns = 0;
  reasonEnded: 'completed' | 'turn_limit' | 'cancelled' = 'completed';

  constructor(config: MeetingConfig) {
    this.id = randomUUID();
    this.topic = config.topic;
    this.context = config.context;
    this.moderatorId = config.moderatorId ?? '__system_moderator__';
    this.turnTimeoutMs = config.turnTimeoutMs ?? 60_000;
    this.maxRebuttalRounds = config.maxRebuttalRounds ?? 1;
    this.maxDeliberationTurns = config.maxDeliberationTurns ?? 10;
    this.maxTotalTurns = config.maxTotalTurns ?? 50;
    this.createdAt = Date.now();
    this.participantIds = config.participants.map((a) => a.id);

    this.agents = new Map(config.participants.map((a) => [a.id, a]));
    this.turnManager = new TurnManager();
    this.moderator = new Moderator(config.defaultLLM ?? null);
    this.summarizer = new Summarizer(config.defaultLLM ?? null);
  }

  private checkTurnLimit(): boolean {
    if (this.totalTurns >= this.maxTotalTurns) {
      this.turnLimitReached = true;
      this.reasonEnded = 'turn_limit';
      this.addMessage(
        '__system_moderator__',
        'Moderator',
        `Maximum turn limit reached (${this.maxTotalTurns} turns). Forcing conclusion.`
      );
      return true;
    }
    return false;
  }

  async start(): Promise<void> {
    this.status = 'active';
    await this.advancePhase(DebatePhase.OPENING);
    await this.runOpening();
    if (this.aborted) return;

    if (!this.turnLimitReached) {
      await this.advancePhase(DebatePhase.POSITION);
      await this.runRoundRobin(DebatePhase.POSITION);
    }
    if (this.aborted) return;

    if (!this.turnLimitReached) {
      for (let r = 0; r < this.maxRebuttalRounds; r++) {
        await this.advancePhase(DebatePhase.REBUTTAL);
        await this.runRoundRobin(DebatePhase.REBUTTAL);
        if (this.aborted || this.turnLimitReached) break;
        this.turnManager.resetRound();
      }
    }
    if (this.aborted) return;

    if (!this.turnLimitReached) {
      await this.advancePhase(DebatePhase.DELIBERATION);
      await this.runDeliberation();
    }
    if (this.aborted) return;

    if (!this.turnLimitReached) {
      await this.advancePhase(DebatePhase.VOTING);
      await this.runVoting();
    }
    if (this.aborted) return;

    await this.advancePhase(DebatePhase.SUMMARY);
    await this.runSummary();
    await this.advancePhase(DebatePhase.CONCLUDED);

    this.status = 'concluded';
    this.concludedAt = Date.now();
  }

  cancel(): void {
    this.aborted = true;
    this.status = 'cancelled';
    if (this.phaseTimeline.length > 0) {
      const current = this.phaseTimeline[this.phaseTimeline.length - 1];
      current.exitedAt = Date.now();
    }
  }

  getSummary(): MeetingSummary | null {
    return this.summary;
  }

  toStoredMeeting(): StoredMeeting {
    return {
      id: this.id,
      topic: this.topic,
      context: this.context,
      status: this.status,
      participantIds: this.participantIds,
      moderatorId: this.moderatorId,
      transcript: this.transcript,
      phaseTimeline: this.phaseTimeline,
      summary: this.summary,
      createdAt: this.createdAt,
      concludedAt: this.concludedAt,
    };
  }

  private async advancePhase(phase: DebatePhase): Promise<void> {
    if (this.phaseTimeline.length > 0) {
      const current = this.phaseTimeline[this.phaseTimeline.length - 1];
      if (current.exitedAt === null) {
        current.exitedAt = Date.now();
      }
    }
    this.currentPhase = phase;
    this.phaseTimeline.push({
      phase,
      enteredAt: Date.now(),
      exitedAt: null,
    });
  }

  private async runOpening(): Promise<void> {
    const openingText = this.moderator.buildOpeningPrompt(
      this.topic,
      this.context,
      [...this.agents.values()]
    );
    this.addMessage(this.moderator.systemModeratorId, this.moderator.systemModeratorName, openingText);
  }

  private async runRoundRobin(phase: DebatePhase): Promise<void> {
    const participants = [...this.agents.values()];
    this.turnManager.setRound(participants);

    while (!this.turnManager.allSpoken()) {
      if (this.aborted) return;
      if (this.checkTurnLimit()) return;
      const speaker = this.turnManager.nextSpeaker();
      if (!speaker) break;

      const agent = this.agents.get(speaker.id);
      if (!agent) continue;

      const currentPrompt =
        phase === DebatePhase.POSITION
          ? this.moderator.buildPositionPrompt(this.topic, speaker.name)
          : this.moderator.buildRebuttalPrompt(this.topic, speaker.name);

      await this.promptAgent(agent, currentPrompt);

      // check for raised hand during position/rebuttal
      const lastMessage = this.transcript
        .slice()
        .reverse()
        .find((m) => m.authorId === agent.id);
      if (lastMessage?.content.includes('[WISHES TO SPEAK]')) {
        this.turnManager.raiseHand(agent.id);
      }
    }
  }

  private async runDeliberation(): Promise<void> {
    let turns = 0;

    // prompt everyone once to raise topics
    const participants = [...this.agents.values()];
    for (const agent of participants) {
      if (this.aborted) return;
      if (this.checkTurnLimit()) return;
      const prompt = this.moderator.buildDeliberationPrompt(this.topic, agent.name);
      await this.promptAgent(agent, prompt);
      turns++;
      if (turns >= this.maxDeliberationTurns) return;
    }

    let stalemateCount = 0;

    // then handle raised hands
    while (this.turnManager.handsRemaining() > 0 && turns < this.maxDeliberationTurns) {
      if (this.aborted) return;
      if (this.checkTurnLimit()) return;

      const agentId = this.turnManager.getNextHand();
      if (!agentId) break;

      const agent = this.agents.get(agentId);
      if (!agent) continue;

      const prompt = `You have the floor for deliberation on "${this.topic}". Make your point and respond to others. If the discussion is going in circles, suggest moving to a vote.`;
      await this.promptAgent(agent, prompt);
      turns++;

      // Stalemate detection: if agents stop raising hands for 2 consecutive rounds
      // during deliberation, assume they've exhausted discussion
      if (this.turnManager.handsRemaining() === 0) {
        stalemateCount++;
        if (stalemateCount >= 2) {
          this.addMessage(
            '__system_moderator__',
            'Moderator',
            'Discussion appears to have reached a natural conclusion. Moving to voting.'
          );
          return;
        }
      } else {
        stalemateCount = 0;
      }
    }
  }

  private async runVoting(): Promise<void> {
    const voteQuestion = `Do you agree with the emerging consensus on this topic?`;
    const votePrompt = this.moderator.buildVotingPrompt(this.topic, voteQuestion);

    for (const agent of this.agents.values()) {
      if (this.aborted) return;
      if (this.checkTurnLimit()) return;
      await this.promptAgent(agent, votePrompt);
    }
  }

  private async runSummary(): Promise<void> {
    const transcriptText = this.transcript
      .map((m) => `[${m.authorName} (${m.phase})]: ${m.content}`)
      .join('\n\n');

    const summary = await this.summarizer.summarize(
      this.topic,
      this.context,
      this.transcript.map((m) => ({
        authorName: m.authorName,
        content: m.content,
      })),
      [...this.agents.values()]
    );

    const voteTally = this.summarizer.parseVotes(
      this.transcript
        .filter((m) => m.phase === DebatePhase.VOTING)
        .map((m) => ({ authorName: m.authorName, content: m.content }))
    );

    summary.voteTally = voteTally;
    this.summary = summary;

    const summaryText = [
      `=== MEETING SUMMARY ===`,
      `Topic: ${this.topic}`,
      `Consensus: ${summary.consensus}`,
      '',
      'Key Points:',
      ...summary.keyPoints.map((p) => `  • ${p}`),
      '',
      'Dissenting Views:',
      ...(summary.dissentingViews.length > 0
        ? summary.dissentingViews.map((v) => `  • ${v}`)
        : ['  (none)']),
      '',
      'Action Items:',
      ...(summary.actionItems.length > 0
        ? summary.actionItems.map((a) => `  • ${a}`)
        : ['  (none)']),
      '',
      voteTally ? `Vote Tally: YES=${voteTally.yes} NO=${voteTally.no} ABSTAIN=${voteTally.abstain}` : '',
    ].join('\n');

    this.addMessage(this.moderator.systemModeratorId, this.moderator.systemModeratorName, summaryText);
  }

  private async promptAgent(agent: IAgent, promptText: string): Promise<void> {
    this.totalTurns++;

    const transcriptMessages: TranscriptMessage[] = this.transcript.map((m) => ({
      id: m.id,
      authorId: m.authorId,
      authorName: m.authorName,
      content: m.content,
      phase: m.phase,
      timestamp: m.timestamp,
    }));

    try {
      const response = await agent.respond({
        meetingId: this.id,
        phase: this.currentPhase,
        topic: this.topic,
        background: this.context,
        transcript: transcriptMessages,
        speakingOrder: this.participantIds,
        currentPrompt: promptText,
      });

      this.addMessage(agent.id, agent.name, response.content);
    } catch {
      this.addMessage(
        agent.id,
        agent.name,
        `[${agent.name} encountered an error and could not respond]`
      );
    }
  }

  private addMessage(authorId: string, authorName: string, content: string): void {
    this.transcript.push({
      id: randomUUID(),
      authorId,
      authorName,
      content,
      phase: this.currentPhase,
      timestamp: Date.now(),
    });
  }
}
