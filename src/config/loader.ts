import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Config, AgentDef } from './types.js';

export function loadConfig(path?: string): Config {
  const configPath = resolve(path ?? './meetings.config.yml');

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = readFileSync(configPath, 'utf-8');
  const interpolated = interpolateEnv(raw);
  const parsed = parseYaml(interpolated);

  const config = parsed as Config;

  validateConfig(config);

  config.agents = config.agents.map((agent) => ({
    ...agent,
    capabilities: agent.capabilities ?? [],
  }));

  return config;
}

function interpolateEnv(raw: string): string {
  return raw.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
}

function validateConfig(config: Config): void {
  if (!config.server) {
    throw new Error('Config must have a `server` section');
  }
  if (!config.server.port || !config.server.host) {
    throw new Error('Server config requires `port` and `host`');
  }
  if (!Array.isArray(config.agents)) {
    throw new Error('Config must have an `agents` array');
  }
  if (!config.meetings) {
    throw new Error('Config must have a `meetings` section');
  }

  const ids = new Set<string>();
  for (const agent of config.agents) {
    if (!agent.id || !agent.name) {
      throw new Error('Each agent must have `id` and `name`');
    }
    if (ids.has(agent.id)) {
      throw new Error(`Duplicate agent id: ${agent.id}`);
    }
    ids.add(agent.id);

    if (agent.type === 'subprocess') {
      if (!agent.command) {
        throw new Error(`Subprocess agent "${agent.id}" requires a command`);
      }
    }
    if (agent.type === 'llm') {
      if (!agent.provider || !agent.model) {
        throw new Error(`LLM agent "${agent.id}" requires provider and model`);
      }
    }
  }

  if (config.meetings.defaultModerator && !ids.has(config.meetings.defaultModerator)) {
    throw new Error(
      `defaultModerator "${config.meetings.defaultModerator}" not found in agents`
    );
  }
}
