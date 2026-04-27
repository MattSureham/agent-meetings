import { Command } from 'commander';
import { loadConfig } from '../../config/loader.js';

export function configCommand(): Command {
  const cmd = new Command('config')
    .description('Validate or show configuration');

  cmd
    .command('validate')
    .description('Validate a config file')
    .option('-c, --config <path>', 'Path to config file', './meetings.config.yml')
    .action(async (options) => {
      try {
        loadConfig(options.config);
        console.log('Config is valid.');
      } catch (e) {
        console.error('Config validation failed:', (e as Error).message);
        process.exit(1);
      }
    });

  cmd
    .command('show')
    .description('Show the current effective config')
    .option('-c, --config <path>', 'Path to config file', './meetings.config.yml')
    .action(async (options) => {
      try {
        const config = loadConfig(options.config);
        const printout = { ...config };
        // Mask API keys
        printout.agents = printout.agents.map((a) => {
          if ('apiKey' in a && a.apiKey) {
            return { ...a, apiKey: '***' };
          }
          return a;
        });
        console.log(JSON.stringify(printout, null, 2));
      } catch (e) {
        console.error('Failed to load config:', (e as Error).message);
        process.exit(1);
      }
    });

  return cmd;
}
