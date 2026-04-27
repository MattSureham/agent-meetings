import type { MeetingPrompt } from '../../types.js';
import { SubprocessAgent, type SubprocessAgentConfig } from '../adapter.js';

export function createClaudeCodeAgent(
  id: string,
  capabilities: string[],
  overrides: Partial<SubprocessAgentConfig> = {}
): SubprocessAgent {
  return new SubprocessAgent({
    id,
    name: 'Claude Code',
    capabilities,
    command: 'claude',
    args: ['-p', '{prompt}', '--output-format', 'text', '--permission-mode', 'bypassPermissions', '--bare'],
    promptMode: 'argument',
    timeoutMs: 120_000,
    ...overrides,
  });
}
