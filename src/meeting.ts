import { Agent } from './agent.js';

export interface Message {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  timestamp: number;
}

export interface Participant {
  agent: Agent;
  role: 'contributor' | 'observer' | 'moderator';
}

export interface MeetingConfig {
  topic: string;
  participants: Agent[];
  context?: string;
  moderator?: Agent;
}

export class AgentMeeting {
  public readonly id: string;
  public readonly topic: string;
  public readonly participants: Participant[];
  public readonly context: string;
  public readonly moderator?: Agent;
  public messages: Message[] = [];
  public status: 'pending' | 'active' | 'concluded' = 'pending';

  constructor(config: MeetingConfig) {
    this.id = crypto.randomUUID();
    this.topic = config.topic;
    this.context = config.context ?? '';
    this.moderator = config.moderator;

    this.participants = config.participants.map((agent) => ({
      agent,
      role: agent === config.moderator ? 'moderator' : 'contributor',
    }));
  }

  async start(): Promise<void> {
    this.status = 'active';
    await this.broadcast(
      `Meeting started: ${this.topic}\nContext: ${this.context}`
    );
  }

  async conclude(): Promise<void> {
    this.status = 'concluded';
    await this.broadcast('Meeting concluded. Thank you all for participating.');
  }

  async sendMessage(author: Agent, content: string): Promise<Message> {
    const message: Message = {
      id: crypto.randomUUID(),
      authorId: author.id,
      authorName: author.name,
      content,
      timestamp: Date.now(),
    };
    this.messages.push(message);
    return message;
  }

  private async broadcast(content: string): Promise<void> {
    for (const { agent } of this.participants) {
      await agent.think(content);
    }
  }
}
