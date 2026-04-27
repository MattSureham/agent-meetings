import { Command } from 'commander';
import { readFileSync } from 'node:fs';

export function scheduleCommand(): Command {
  return new Command('schedule')
    .description('Schedule a new meeting')
    .requiredOption('-t, --topic <topic>', 'Meeting topic')
    .requiredOption('-a, --agents <ids>', 'Comma-separated agent IDs')
    .option('-m, --moderator <id>', 'Agent ID to act as moderator')
    .option('-x, --context <text>', 'Background context or path to file')
    .option('-s, --server <url>', 'Server URL', 'http://localhost:4200')
    .option('--no-auto-start', 'Do not start the meeting immediately')
    .action(async (options) => {
      const topic = options.topic;
      const participantIds = options.agents.split(',').map((s: string) => s.trim());
      const moderatorId = options.moderator;
      let context = options.context ?? '';

      // If context looks like a file path, read it
      if (context && !context.includes('\n')) {
        try {
          context = readFileSync(context, 'utf-8');
        } catch {
          // treat as literal text
        }
      }

      try {
        const response = await fetch(`${options.server}/meetings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            topic,
            participantIds,
            moderatorId,
            context,
            autoStart: options.autoStart,
          }),
        });

        const body = (await response.json()) as { id: string; status: string; error?: string };
        if (response.ok) {
          console.log(`Meeting scheduled: ${body.id}`);
          console.log(`  Topic: ${topic}`);
          console.log(`  Status: ${body.status}`);
        } else {
          console.error('Error:', body.error);
          process.exit(1);
        }
      } catch (e) {
        console.error('Failed to schedule meeting — is the server running?');
        console.error(e);
        process.exit(1);
      }
    });
}
