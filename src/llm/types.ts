export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMAdapter {
  readonly provider: string;
  readonly model: string;
  chat(messages: ChatMessage[]): Promise<string>;
}
