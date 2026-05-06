import { randomUUID } from 'node:crypto';
import type { IAgent, TranscriptMessage } from '../agent/types.js';
import type { LLMAdapter } from '../llm/types.js';
import {
  MeetingPhase,
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
  mode?: 'debate' | 'collaboration';
  workDir?: string;
  turnTimeoutMs?: number;
  maxRebuttalRounds?: number;
  maxDeliberationRounds?: number;
  defaultLLM?: LLMAdapter;
  onTurnStart?: (agentName: string) => void;
  onTurnEnd?: (agentName: string) => void;
}

export class MeetingEngine {
  readonly id: string;
  readonly topic: string;
  readonly context: string;
  readonly participantIds: string[];
  readonly moderatorId: string;
  readonly mode: 'debate' | 'collaboration';

  status: MeetingStatus = 'pending';
  currentPhase: MeetingPhase = MeetingPhase.OPENING;
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
  private maxDeliberationRounds: number;
  private aborted = false;
  private totalTurns = 0;
  reasonEnded: 'completed' | 'cancelled' = 'completed';
  currentTurn: string | null = null;

  constructor(config: MeetingConfig) {
    this.id = randomUUID();
    this.topic = config.topic;
    this.context = config.context;
    this.moderatorId = config.moderatorId ?? '__system_moderator__';
    this.mode = config.mode ?? 'debate';
    this.turnTimeoutMs = config.turnTimeoutMs ?? 60_000;
    this.maxRebuttalRounds = config.maxRebuttalRounds ?? 1;
    this.maxDeliberationRounds = config.maxDeliberationRounds ?? 3;
    this.createdAt = Date.now();
    this.participantIds = config.participants.map((a) => a.id);

    this.agents = new Map(config.participants.map((a) => [a.id, a]));
    this.turnManager = new TurnManager();
    this.moderator = new Moderator(config.defaultLLM ?? null, this.mode, config.workDir ?? null);
    this.summarizer = new Summarizer(config.defaultLLM ?? null);
    this.onTurnStart = config.onTurnStart;
    this.onTurnEnd = config.onTurnEnd;
  }

  async start(): Promise<void> {
    this.status = 'active';

    if (this.mode === 'collaboration') {
      await this.runCollaboration();
    } else {
      await this.runDebate();
    }

    if (this.aborted) return;

    await this.advancePhase(MeetingPhase.SUMMARY);
    await this.runSummary();
    await this.advancePhase(MeetingPhase.CONCLUDED);

    this.status = 'concluded';
    this.concludedAt = Date.now();
  }

  private async runDebate(): Promise<void> {
    await this.advancePhase(MeetingPhase.OPENING);
    await this.runOpening();
    if (this.aborted) return;

    await this.advancePhase(MeetingPhase.POSITION);
    await this.runRoundRobin(MeetingPhase.POSITION);
    if (this.aborted) return;

    for (let r = 0; r < this.maxRebuttalRounds; r++) {
      await this.advancePhase(MeetingPhase.REBUTTAL);
      await this.runRoundRobin(MeetingPhase.REBUTTAL);
      if (this.aborted) break;
      this.turnManager.resetRound();
    }
    if (this.aborted) return;

    await this.advancePhase(MeetingPhase.DELIBERATION);
    await this.runDeliberation();
    if (this.aborted) return;

    await this.advancePhase(MeetingPhase.VOTING);
    await this.runVoting();
  }

  private async runCollaboration(): Promise<void> {
    await this.advancePhase(MeetingPhase.OPENING);
    await this.runOpening();
    if (this.aborted) return;

    await this.advancePhase(MeetingPhase.PLAN);
    await this.runRoundRobin(MeetingPhase.PLAN);
    if (this.aborted) return;

    await this.advancePhase(MeetingPhase.BUILD);
    await this.runRoundRobin(MeetingPhase.BUILD);
    if (this.aborted) return;

    await this.advancePhase(MeetingPhase.REVIEW);
    await this.runRoundRobin(MeetingPhase.REVIEW);
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
      mode: this.mode,
      participantIds: this.participantIds,
      moderatorId: this.moderatorId,
      transcript: this.transcript,
      phaseTimeline: this.phaseTimeline,
      summary: this.summary,
      currentTurn: this.currentTurn,
      currentPhase: this.currentPhase,
      createdAt: this.createdAt,
      concludedAt: this.concludedAt,
    };
  }

  private async advancePhase(phase: MeetingPhase): Promise<void> {
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

  private async runRoundRobin(phase: MeetingPhase): Promise<void> {
    let participants = [...this.agents.values()];

    // BUILD phase: only subprocess agents can actually execute tools
    if (phase === MeetingPhase.BUILD) {
      participants = participants.filter((a) => a.type === 'subprocess');
      if (participants.length === 0) {
        this.addMessage(
          '__system_moderator__',
          'Moderator',
          'No builder agents available for BUILD phase. Skipping.'
        );
        return;
      }
    }

    this.turnManager.setRound(participants);

    while (!this.turnManager.allSpoken()) {
      if (this.aborted) return;
      const speaker = this.turnManager.nextSpeaker();
      if (!speaker) break;

      const agent = this.agents.get(speaker.id);
      if (!agent) continue;

      let currentPrompt: string;
      if (phase === MeetingPhase.POSITION) {
        currentPrompt = this.moderator.buildPositionPrompt(this.topic, speaker.name);
      } else if (phase === MeetingPhase.REBUTTAL) {
        currentPrompt = this.moderator.buildRebuttalPrompt(this.topic, speaker.name);
      } else if (phase === MeetingPhase.PLAN) {
        currentPrompt = this.moderator.buildPlanPrompt(this.topic, speaker.name);
      } else if (phase === MeetingPhase.BUILD) {
        currentPrompt = this.moderator.buildBuildPrompt(this.topic, speaker.name);
      } else {
        currentPrompt = this.moderator.buildReviewPrompt(this.topic, speaker.name);
      }

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
    let rounds = 0;

    // Round 1: prompt everyone to raise topics
    const participants = [...this.agents.values()];
    for (const agent of participants) {
      if (this.aborted) return;
      const prompt = this.moderator.buildDeliberationPrompt(this.topic, agent.name);
      await this.promptAgent(agent, prompt);
    }
    rounds++;
    if (rounds >= this.maxDeliberationRounds) return;

    let stalemateCount = 0;

    // Rounds 2+: each round, everyone with raised hands gets to speak
    while (this.turnManager.handsRemaining() > 0 && rounds < this.maxDeliberationRounds) {
      if (this.aborted) return;

      // Collect all currently raised hands
      const roundSpeakers: string[] = [];
      while (this.turnManager.handsRemaining() > 0) {
        const id = this.turnManager.getNextHand();
        if (id) roundSpeakers.push(id);
      }

      for (const agentId of roundSpeakers) {
        if (this.aborted) return;
        const agent = this.agents.get(agentId);
        if (!agent) continue;
        const prompt = `You have the floor for deliberation on "${this.topic}". Make your point and respond to others. If the discussion is going in circles, suggest moving to a vote.`;
        await this.promptAgent(agent, prompt);
      }

      rounds++;

      // Stalemate: if no new hands raised this round, assume discussion exhausted
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
      await this.promptAgent(agent, votePrompt);
    }
  }

  private async runSummary(): Promise<void> {
    const transcriptText = this.transcript
      .map((m) => `[${m.authorName} (${m.phase})]: ${m.content}`)
      .join('\n\n');

    const summary = await Promise.race([
      this.summarizer.summarize(
        this.topic,
        this.context,
        this.transcript.map((m) => ({
          authorName: m.authorName,
          content: m.content,
        })),
        [...this.agents.values()],
        this.mode
      ),
      new Promise<MeetingSummary>((resolve) =>
        setTimeout(() => resolve({
          consensus: 'Summary generation timed out.',
          keyPoints: [],
          dissentingViews: [],
          actionItems: [],
        }), this.turnTimeoutMs)
      ),
    ]);

    if (this.mode !== 'collaboration') {
      const voteTally = this.summarizer.parseVotes(
        this.transcript
          .filter((m) => m.phase === MeetingPhase.VOTING)
          .map((m) => ({ authorName: m.authorName, content: m.content }))
      );
      summary.voteTally = voteTally;
    }
    this.summary = summary;

    const heading = this.mode === 'collaboration' ? 'PROJECT SUMMARY' : 'MEETING SUMMARY';
    const lines: string[] = [
      `=== ${heading} ===`,
      `Topic: ${this.topic}`,
      `Consensus: ${summary.consensus}`,
      '',
      'Key Points:',
      ...summary.keyPoints.map((p) => `  • ${p}`),
    ];

    if (this.mode === 'collaboration') {
      if (summary.deliverables && summary.deliverables.length > 0) {
        lines.push('', 'Deliverables:', ...summary.deliverables.map((d) => `  • ${d}`));
      }
      if (summary.decisions && summary.decisions.length > 0) {
        lines.push('', 'Key Decisions:', ...summary.decisions.map((d) => `  • ${d}`));
      }
    } else {
      lines.push(
        '',
        'Dissenting Views:',
        ...(summary.dissentingViews.length > 0
          ? summary.dissentingViews.map((v) => `  • ${v}`)
          : ['  (none)'])
      );
      if (summary.voteTally) {
        const t = summary.voteTally;
        lines.push('', `Vote Tally: YES=${t.yes} NO=${t.no} ABSTAIN=${t.abstain}`);
      }
    }

    lines.push(
      '',
      'Action Items:',
      ...(summary.actionItems.length > 0
        ? summary.actionItems.map((a) => `  • ${a}`)
        : ['  (none)'])
    );

    const summaryText = lines.join('\n');

    this.addMessage(this.moderator.systemModeratorId, this.moderator.systemModeratorName, summaryText);
  }

  private onTurnStart?: (agentName: string) => void;
  private onTurnEnd?: (agentName: string) => void;

  private async promptAgent(agent: IAgent, promptText: string): Promise<void> {
    this.totalTurns++;
    this.currentTurn = agent.name;
    this.onTurnStart?.(agent.name);

    const transcriptMessages: TranscriptMessage[] = this.transcript.map((m) => ({
      id: m.id,
      authorId: m.authorId,
      authorName: m.authorName,
      content: m.content,
      phase: m.phase,
      timestamp: m.timestamp,
    }));

    try {
      const started = Date.now();
      const response = await agent.respond({
        meetingId: this.id,
        phase: this.currentPhase,
        topic: this.topic,
        background: this.context,
        transcript: transcriptMessages,
        speakingOrder: this.participantIds,
        currentPrompt: promptText,
      });

      this.addMessage(agent.id, agent.name, response.content, Date.now() - started);
    } catch (e) {
      console.error(`[engine] ${agent.name} failed:`, e instanceof Error ? e.message : e);
      this.addMessage(
        agent.id,
        agent.name,
        `[${agent.name} encountered an error and could not respond]`
      );
    } finally {
      this.currentTurn = null;
      this.onTurnEnd?.(agent.name);
    }
  }

  private addMessage(authorId: string, authorName: string, content: string, durationMs?: number): void {
    this.transcript.push({
      id: randomUUID(),
      authorId,
      authorName,
      content,
      phase: this.currentPhase,
      timestamp: Date.now(),
      durationMs,
    });
  }
}
