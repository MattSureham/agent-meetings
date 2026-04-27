#!/usr/bin/env node

import { Command } from 'commander';
import { serveCommand } from './commands/serve.js';
import { scheduleCommand } from './commands/schedule.js';
import { listCommand } from './commands/list.js';
import { viewCommand } from './commands/view.js';
import { configCommand } from './commands/config.js';
import { runCommand } from './commands/run.js';

const program = new Command();

program
  .name('agent-meetings')
  .alias('am')
  .description('Framework for structured technical meetings between AI agents and LLMs')
  .version('0.1.0');

program.addCommand(runCommand());
program.addCommand(serveCommand());
program.addCommand(scheduleCommand());
program.addCommand(listCommand());
program.addCommand(viewCommand());
program.addCommand(configCommand());

program.parse(process.argv);
