import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IAgent, AgentHealth, AgentResponse, MeetingPrompt } from '../types.js';
import { SubprocessManager } from './manager.js';

export interface SubprocessAgentConfig {
  id: string;
  name: string;
  capabilities: string[];
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  promptMode: 'argument' | 'stdin' | 'file';
  buildArgs?: (prompt: MeetingPrompt) => string[];
  buildInput?: (prompt: MeetingPrompt) => string;
}

export class SubprocessAgent implements IAgent {
  readonly type = 'subprocess';
  readonly id: string;
  readonly name: string;
  readonly capabilities: string[];
  private manager: SubprocessManager;
  private config: SubprocessAgentConfig;

  constructor(config: SubprocessAgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.capabilities = config.capabilities;
    this.config = config;
    this.manager = new SubprocessManager();
  }

  async respond(prompt: MeetingPrompt): Promise<AgentResponse> {
    const promptText = this.buildPromptText(prompt);

    if (this.config.promptMode === 'file') {
      return this.respondViaFile(prompt, promptText);
    }
    if (this.config.promptMode === 'stdin') {
      return this.respondViaStdin(prompt, promptText);
    }
    return this.respondViaArgs(prompt);
  }

  private replaceTokens(args: string[], prompt: MeetingPrompt, promptText: string, filePath?: string): string[] {
    return args.map((a) => {
      let result = a;
      if (result === '{prompt}') result = promptText;
      else result = result.replace('{prompt}', promptText);
      result = result.replace('{meetingId}', prompt.meetingId);
      if (filePath) result = result.replace('{file}', filePath);
      return result;
    });
  }

  private async respondViaArgs(prompt: MeetingPrompt): Promise<AgentResponse> {
    const promptText = this.buildPromptText(prompt);
    const args = this.replaceTokens(this.config.args, prompt, promptText);

    const result = await this.manager.run({
      command: this.config.command,
      args,
      cwd: this.config.cwd,
      env: this.config.env,
      timeoutMs: this.config.timeoutMs,
    });

    if (result.timedOut) {
      return { content: `[${this.name} did not respond within the time limit]` };
    }
    return { content: result.stdout || result.stderr || `[${this.name} produced no output]` };
  }

  private async respondViaStdin(prompt: MeetingPrompt, promptText: string): Promise<AgentResponse> {
    const args = this.replaceTokens(this.config.args, prompt, promptText);
    const result = await this.manager.run({
      command: this.config.command,
      args,
      cwd: this.config.cwd,
      env: this.config.env,
      timeoutMs: this.config.timeoutMs,
      input: promptText,
    });

    if (result.timedOut) {
      return { content: `[${this.name} did not respond within the time limit]` };
    }
    return { content: result.stdout || result.stderr || `[${this.name} produced no output]` };
  }

  private async respondViaFile(prompt: MeetingPrompt, promptText: string): Promise<AgentResponse> {
    const dir = await mkdtemp(join(tmpdir(), 'agent-meeting-'));
    const filePath = join(dir, 'prompt.txt');

    try {
      await writeFile(filePath, promptText, 'utf-8');

      const args = this.replaceTokens(this.config.args, prompt, promptText, filePath);

      const result = await this.manager.run({
        command: this.config.command,
        args,
        cwd: this.config.cwd,
        env: this.config.env,
        timeoutMs: this.config.timeoutMs,
      });

      if (result.timedOut) {
        return { content: `[${this.name} did not respond within the time limit]` };
      }
      return { content: result.stdout || result.stderr || `[${this.name} produced no output]` };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async health(): Promise<AgentHealth> {
    const start = Date.now();
    try {
      const exists = await this.manager.healthCheck(this.config.command);
      if (!exists) {
        return { status: 'offline', lastCheck: Date.now(), error: `Command "${this.config.command}" not found` };
      }
      return { status: 'healthy', lastCheck: Date.now(), latencyMs: Date.now() - start };
    } catch (e) {
      return { status: 'unhealthy', lastCheck: Date.now(), error: String(e) };
    }
  }

  async shutdown(): Promise<void> {
    await this.manager.shutdown();
  }

  private buildPromptText(prompt: MeetingPrompt): string {
    return [
      `You are "${this.name}" participating in a structured debate meeting.`,
      `MEETING TOPIC: ${prompt.topic}`,
      `BACKGROUND: ${prompt.background || 'None provided.'}`,
      `CURRENT PHASE: ${prompt.phase.toUpperCase()}`,
      '',
      'CONVERSATION SO FAR:',
      ...prompt.transcript.map((m) => `[${m.authorName} (${m.phase})]: ${m.content}`),
      '',
      `YOUR TURN — ${prompt.currentPrompt}`,
    ].join('\n');
  }
}
