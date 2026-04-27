import type { SiteConfig } from '../types.js';

export const geminiSite: SiteConfig = {
  id: 'gemini',
  url: 'https://gemini.google.com',
  inputSelector: 'rich-textarea [contenteditable="true"]',
  responseSelector: '.model-response-text',
  waitStrategy: 'typing-indicator',
  typingIndicatorSelector: '.typing-indicator, .loading',
  newChatUrl: 'https://gemini.google.com/app',
};
