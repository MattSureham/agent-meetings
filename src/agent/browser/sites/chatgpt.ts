import type { SiteConfig } from '../types.js';

export const chatgptSite: SiteConfig = {
  id: 'chatgpt',
  url: 'https://chatgpt.com',
  inputSelector: '#prompt-textarea',
  responseSelector: '[data-message-author-role="assistant"]',
  waitStrategy: 'stop-button',
  stopButtonSelector: 'button[data-testid="stop-button"]',
  newChatUrl: 'https://chatgpt.com/?model=gpt-4o',
};
