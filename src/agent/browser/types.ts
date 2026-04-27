export interface SiteConfig {
  id: string;
  url: string;
  inputSelector: string;
  submitSelector?: string;         // if omitted, presses Enter
  responseSelector: string;
  waitStrategy: 'stop-button' | 'typing-indicator' | 'fixed-delay';
  stopButtonSelector?: string;
  typingIndicatorSelector?: string;
  waitAfterMs?: number;
  clearChatSelector?: string;
  newChatUrl?: string;
}
