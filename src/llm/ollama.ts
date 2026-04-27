import type { ChatMessage, LLMAdapter } from './types.js';

export class OllamaAdapter implements LLMAdapter {
  readonly provider = 'ollama';

  constructor(
    readonly model: string,
    private endpoint: string = 'http://127.0.0.1:11434'
  ) {}

  async chat(messages: ChatMessage[]): Promise<string> {
    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${err}`);
    }

    const data = (await response.json()) as { message: { content: string } };
    return data.message?.content ?? '';
  }
}
