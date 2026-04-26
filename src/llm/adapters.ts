/**
 * LLM Provider Adapters
 * 
 * Currently supported providers can be added here.
 * Each adapter implements the LLMAdapter interface.
 */

export interface LLMAdapter {
  complete(prompt: string): Promise<string>;
  completeWithContext(prompt: string, context: string): Promise<string>;
}

// Placeholder for future provider implementations
export class ClaudeAdapter implements LLMAdapter {
  constructor(private apiKey: string) {}

  async complete(prompt: string): Promise<string> {
    // TODO: Implement Claude API integration
    return `[Claude] ${prompt}`;
  }

  async completeWithContext(prompt: string, context: string): Promise<string> {
    return `[Claude] Context: ${context}\nPrompt: ${prompt}`;
  }
}

export class GPTAdapter implements LLMAdapter {
  constructor(private apiKey: string, private model = 'gpt-4') {}

  async complete(prompt: string): Promise<string> {
    // TODO: Implement OpenAI API integration
    return `[GPT-${this.model}] ${prompt}`;
  }

  async completeWithContext(prompt: string, context: string): Promise<string> {
    return `[GPT-${this.model}] Context: ${context}\nPrompt: ${prompt}`;
  }
}

export class GeminiAdapter implements LLMAdapter {
  constructor(private apiKey: string) {}

  async complete(prompt: string): Promise<string> {
    // TODO: Implement Gemini API integration
    return `[Gemini] ${prompt}`;
  }

  async completeWithContext(prompt: string, context: string): Promise<string> {
    return `[Gemini] Context: ${context}\nPrompt: ${prompt}`;
  }
}

export class LocalAdapter implements LLMAdapter {
  constructor(private endpoint: string) {}

  async complete(prompt: string): Promise<string> {
    // TODO: Implement local/Ollama-style API integration
    return `[Local] ${prompt}`;
  }

  async completeWithContext(prompt: string, context: string): Promise<string> {
    return `[Local] Context: ${context}\nPrompt: ${prompt}`;
  }
}
