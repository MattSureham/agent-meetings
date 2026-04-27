import { SubprocessAgent, type SubprocessAgentConfig } from '../adapter.js';

export function createGenericSubprocessAgent(config: SubprocessAgentConfig): SubprocessAgent {
  return new SubprocessAgent(config);
}
