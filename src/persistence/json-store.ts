import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { MeetingStatus, StoredMeeting } from '../meeting/types.js';
import type { DataStore, StoredAgent } from './types.js';

export class JsonFileStore implements DataStore {
  private meetingsDir: string;
  private agentsPath: string;

  constructor(dataDir: string) {
    this.meetingsDir = join(dataDir, 'meetings');
    this.agentsPath = join(dataDir, 'agents.json');
  }

  async init(): Promise<void> {
    await mkdir(this.meetingsDir, { recursive: true });
  }

  async saveMeeting(meeting: StoredMeeting): Promise<void> {
    await mkdir(this.meetingsDir, { recursive: true });
    await writeFile(
      join(this.meetingsDir, `${meeting.id}.json`),
      JSON.stringify(meeting, null, 2),
      'utf-8'
    );
  }

  async getMeeting(id: string): Promise<StoredMeeting | null> {
    try {
      const data = await readFile(join(this.meetingsDir, `${id}.json`), 'utf-8');
      return JSON.parse(data) as StoredMeeting;
    } catch {
      return null;
    }
  }

  async listMeetings(filter?: { status?: MeetingStatus }): Promise<StoredMeeting[]> {
    await mkdir(this.meetingsDir, { recursive: true });
    const files = await readdir(this.meetingsDir);
    const meetings: StoredMeeting[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = await readFile(join(this.meetingsDir, file), 'utf-8');
        const meeting = JSON.parse(data) as StoredMeeting;
        if (!filter?.status || meeting.status === filter.status) {
          meetings.push(meeting);
        }
      } catch {
        // skip corrupt files
      }
    }

    meetings.sort((a, b) => b.createdAt - a.createdAt);
    return meetings;
  }

  async saveAgent(agent: StoredAgent): Promise<void> {
    const agents = await this.listAgents();
    const idx = agents.findIndex((a) => a.id === agent.id);
    if (idx >= 0) agents[idx] = agent;
    else agents.push(agent);
    await writeFile(this.agentsPath, JSON.stringify(agents, null, 2), 'utf-8');
  }

  async listAgents(): Promise<StoredAgent[]> {
    try {
      const data = await readFile(this.agentsPath, 'utf-8');
      return JSON.parse(data) as StoredAgent[];
    } catch {
      return [];
    }
  }

  async deleteAgent(id: string): Promise<void> {
    const agents = await this.listAgents();
    const filtered = agents.filter((a) => a.id !== id);
    await writeFile(this.agentsPath, JSON.stringify(filtered, null, 2), 'utf-8');
  }

  async deleteMeeting(id: string): Promise<void> {
    try {
      await unlink(join(this.meetingsDir, `${id}.json`));
    } catch {
      // file already gone
    }
  }
}
