import { SubprocessAgent, type SubprocessAgentConfig } from '../adapter.js';

export function createGenericSubprocessAgent(config: SubprocessAgentConfig): SubprocessAgent {
  return new SubprocessAgent(config);
}

export function parseOpenClawOutput(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout);
    if (parsed.payloads && Array.isArray(parsed.payloads)) {
      return parsed.payloads
        .map((p: { text?: string }) => p.text ?? '')
        .filter(Boolean)
        .join('\n\n');
    }
    return stdout;
  } catch {
    return stdout;
  }
}
