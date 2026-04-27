import type { ChatMessage, LLMAdapter } from './types.js';

export class AnthropicAdapter implements LLMAdapter {
  readonly provider = 'anthropic';

  constructor(
    private apiKey: string,
    readonly model: string = 'claude-sonnet-4-20250514'
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        messages: chatMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    return data.content.map((c) => c.text).join('');
  }
}
