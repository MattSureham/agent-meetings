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

  warnMissingEnvVars(config.agents);

  return config;
}

const missingEnvVars: string[] = [];

function interpolateEnv(raw: string): string {
  return raw.replace(/\$\{(\w+)\}/g, (_, name) => {
    const value = process.env[name];
    if (!value) {
      missingEnvVars.push(name);
      return '';
    }
    return value;
  });
}

function warnMissingEnvVars(agents: AgentDef[]): void {
  if (missingEnvVars.length > 0) {
    const unique = [...new Set(missingEnvVars)];
    console.warn('⚠  The following environment variables are referenced in your config but not set:');
    for (const v of unique) {
      console.warn(`   $${v}`);
    }
    const affected = agents.filter((a) =>
      'apiKey' in a && a.apiKey === ''
    );
    if (affected.length > 0) {
      console.warn('   Affected agents:', affected.map((a) => a.id).join(', '));
      console.warn('   These agents may fail when called.');
    }
    console.warn();
  }
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
    if (agent.type === 'browser') {
      if (!agent.site) {
        throw new Error(`Browser agent "${agent.id}" requires a site`);
      }
    }
  }

  if (config.meetings.defaultModerator && !ids.has(config.meetings.defaultModerator)) {
    throw new Error(
      `defaultModerator "${config.meetings.defaultModerator}" not found in agents`
    );
  }

  if (
    config.meetings.mode &&
    !['debate', 'collaboration'].includes(config.meetings.mode)
  ) {
    throw new Error(`meetings.mode must be "debate" or "collaboration"`);
  }

  // Apply defaults
  config.meetings.mode = config.meetings.mode ?? 'debate';
  config.meetings.maxTotalTurns = config.meetings.maxTotalTurns ?? 50;
}
