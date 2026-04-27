import type { IAgent } from '../agent/types.js';

export interface TurnOrder {
  id: string;
  name: string;
  hasSpoken: boolean;
}

export class TurnManager {
  private order: TurnOrder[] = [];
  private currentIdx = 0;
  private handRaised: string[] = [];
  private speakerHistory: string[] = [];

  setRound(agents: IAgent[]): void {
    this.order = agents.map((a) => ({
      id: a.id,
      name: a.name,
      hasSpoken: false,
    }));
    this.currentIdx = 0;
  }

  nextSpeaker(): TurnOrder | null {
    const remaining = this.order.filter((t) => !t.hasSpoken);
    if (remaining.length === 0) return null;

    const next = remaining[0];
    next.hasSpoken = true;
    this.speakerHistory.push(next.id);
    return next;
  }

  allSpoken(): boolean {
    return this.order.every((t) => t.hasSpoken);
  }

  resetRound(): void {
    this.order.forEach((t) => {
      t.hasSpoken = false;
    });
  }

  raiseHand(agentId: string): void {
    if (!this.handRaised.includes(agentId)) {
      this.handRaised.push(agentId);
    }
  }

  getNextHand(): string | null {
    if (this.handRaised.length === 0) return null;
    const id = this.handRaised.shift()!;
    this.speakerHistory.push(id);
    return id;
  }

  handsRemaining(): number {
    return this.handRaised.length;
  }
}
