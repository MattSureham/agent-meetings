export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
}

export interface SubprocessAgentDef {
  id: string;
  name: string;
  type: 'subprocess';
  tool: string;
  capabilities: string[];
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
}

export interface LLMAgentDef {
  id: string;
  name: string;
  type: 'llm';
  capabilities: string[];
  provider: 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'deepseek' | 'minimax';
  model: string;
  apiKey: string;
  endpoint?: string;
}

export type AgentDef = SubprocessAgentDef | LLMAgentDef;

export interface MeetingsConfig {
  turnTimeoutMs: number;
  maxRebuttalRounds: number;
  maxDeliberationTurns: number;
  defaultModerator: string;
}

export interface Config {
  server: ServerConfig;
  agents: AgentDef[];
  meetings: MeetingsConfig;
}
