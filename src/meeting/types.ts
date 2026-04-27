export enum DebatePhase {
  OPENING = 'opening',
  POSITION = 'position',
  REBUTTAL = 'rebuttal',
  DELIBERATION = 'deliberation',
  VOTING = 'voting',
  SUMMARY = 'summary',
  CONCLUDED = 'concluded',
}

export const PHASE_TRANSITIONS: Record<DebatePhase, DebatePhase[]> = {
  [DebatePhase.OPENING]: [DebatePhase.POSITION],
  [DebatePhase.POSITION]: [DebatePhase.REBUTTAL],
  [DebatePhase.REBUTTAL]: [DebatePhase.DELIBERATION, DebatePhase.VOTING],
  [DebatePhase.DELIBERATION]: [DebatePhase.VOTING, DebatePhase.SUMMARY],
  [DebatePhase.VOTING]: [DebatePhase.SUMMARY],
  [DebatePhase.SUMMARY]: [DebatePhase.CONCLUDED],
  [DebatePhase.CONCLUDED]: [],
};

export type MeetingStatus = 'pending' | 'active' | 'concluded' | 'cancelled';

export interface Message {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  phase: DebatePhase;
  timestamp: number;
}

export interface PhaseTransition {
  phase: DebatePhase;
  enteredAt: number;
  exitedAt: number | null;
}

export interface MeetingSummary {
  consensus: string;
  keyPoints: string[];
  dissentingViews: string[];
  actionItems: string[];
  voteTally?: Record<string, number>;
}

export interface StoredMeeting {
  id: string;
  topic: string;
  context: string;
  status: MeetingStatus;
  participantIds: string[];
  moderatorId: string;
  transcript: Message[];
  phaseTimeline: PhaseTransition[];
  summary: MeetingSummary | null;
  createdAt: number;
  concludedAt: number | null;
}
