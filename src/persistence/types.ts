import type { MeetingStatus, StoredMeeting } from '../meeting/types.js';

export interface StoredAgent {
  id: string;
  name: string;
  capabilities: string[];
  type: 'subprocess' | 'protocol' | 'llm' | 'browser';
  status: 'online' | 'offline';
  lastHeartbeat: number;
  registeredAt: number;
}

export interface DataStore {
  saveMeeting(meeting: StoredMeeting): Promise<void>;
  getMeeting(id: string): Promise<StoredMeeting | null>;
  listMeetings(filter?: { status?: MeetingStatus }): Promise<StoredMeeting[]>;

  saveAgent(agent: StoredAgent): Promise<void>;
  listAgents(): Promise<StoredAgent[]>;
  deleteAgent(id: string): Promise<void>;
}
