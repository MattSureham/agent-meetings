import type { LLMAdapter } from './llm/adapters.js';

export interface AgentConfig {
  id: string;
  name: string;
  capabilities: string[];
  llm: LLMAdapter;
}

export class Agent {
  public readonly id: string;
  public readonly name: string;
  public readonly capabilities: string[];
  protected llm: LLMAdapter;

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.capabilities = config.capabilities;
    this.llm = config.llm;
  }

  async think(prompt: string): Promise<string> {
    return this.llm.complete(prompt);
  }

  canContribute(topic: string): boolean {
    const topicLower = topic.toLowerCase();
    return this.capabilities.some(
      (cap) => topicLower.includes(cap.toLowerCase()) || cap === '*'
    );
  }
}
