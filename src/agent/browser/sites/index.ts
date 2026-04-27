import { registerSite } from '../adapter.js';
import { chatgptSite } from './chatgpt.js';
import { claudeSite } from './claude.js';
import { geminiSite } from './gemini.js';
import { deepseekSite } from './deepseek.js';

export function registerBuiltinSites(): void {
  registerSite(chatgptSite);
  registerSite(claudeSite);
  registerSite(geminiSite);
  registerSite(deepseekSite);
}
