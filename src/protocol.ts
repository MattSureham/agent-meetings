import { Agent } from './agent.js';

export interface ProtocolMessage {
  id: string;
  type: 'discovery' | 'meeting_request' | 'meeting_accept' | 'meeting_reject' | 'message';
  from: string;
  to: string | '*';
  payload: Record<string, unknown>;
  timestamp: number;
}

export class MeetingProtocol {
  private agents: Map<string, Agent> = new Map();

  register(agent: Agent): void {
    this.agents.set(agent.id, agent);
  }

  unregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  listAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  findAgents(capability: string): Agent[] {
    return this.listAgents().filter((agent) =>
      agent.capabilities.some(
        (cap) => cap === '*' || cap.toLowerCase().includes(capability.toLowerCase())
      )
    );
  }

  createMessage(
    type: ProtocolMessage['type'],
    from: string,
    to: string | '*',
    payload: Record<string, unknown>
  ): ProtocolMessage {
    return {
      id: crypto.randomUUID(),
      type,
      from,
      to,
      payload,
      timestamp: Date.now(),
    };
  }

  dispatch(message: ProtocolMessage): ProtocolMessage | null {
    if (message.to === '*') {
      return message;
    }
    const recipient = this.agents.get(message.to);
    if (!recipient) return null;
    return message;
  }
}
