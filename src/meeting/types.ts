export enum MeetingPhase {
  // Debate phases
  OPENING = 'opening',
  POSITION = 'position',
  REBUTTAL = 'rebuttal',
  DELIBERATION = 'deliberation',
  VOTING = 'voting',
  // Collaboration phases
  PLAN = 'plan',
  BUILD = 'build',
  REVIEW = 'review',
  // Shared
  SUMMARY = 'summary',
  CONCLUDED = 'concluded',
}

/** @deprecated Use MeetingPhase */
export const DebatePhase = MeetingPhase;
export type DebatePhase = MeetingPhase;

export type MeetingStatus = 'pending' | 'active' | 'concluded' | 'cancelled';

export interface Message {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  phase: MeetingPhase;
  timestamp: number;
}

export interface PhaseTransition {
  phase: MeetingPhase;
  enteredAt: number;
  exitedAt: number | null;
}

export interface MeetingSummary {
  consensus: string;
  keyPoints: string[];
  dissentingViews: string[];
  actionItems: string[];
  voteTally?: Record<string, number>;
  deliverables?: string[];
  decisions?: string[];
}

export interface StoredMeeting {
  id: string;
  topic: string;
  context: string;
  status: MeetingStatus;
  mode: string;
  participantIds: string[];
  moderatorId: string;
  transcript: Message[];
  phaseTimeline: PhaseTransition[];
  summary: MeetingSummary | null;
  createdAt: number;
  concludedAt: number | null;
}
