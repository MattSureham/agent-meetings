import type { SiteConfig } from '../types.js';

export const claudeSite: SiteConfig = {
  id: 'claude',
  url: 'https://claude.ai',
  inputSelector: '[contenteditable="true"]',
  responseSelector: '.font-claude-message',
  waitStrategy: 'stop-button',
  stopButtonSelector: 'button[aria-label="Stop"]',
  newChatUrl: 'https://claude.ai/new',
};
