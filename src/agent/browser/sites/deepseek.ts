import type { SiteConfig } from '../types.js';

export const deepseekSite: SiteConfig = {
  id: 'deepseek',
  url: 'https://chat.deepseek.com',
  inputSelector: 'textarea',
  responseSelector: '.ds-markdown',
  waitStrategy: 'stop-button',
  stopButtonSelector: 'button:has(svg)',    // deepseek's stop/abort button
  newChatUrl: 'https://chat.deepseek.com',
};
