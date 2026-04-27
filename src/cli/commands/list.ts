import { Command } from 'commander';

export function listCommand(): Command {
  return new Command('list')
    .description('List agents or meetings')
    .argument('<resource>', 'agents or meetings')
    .option('-s, --server <url>', 'Server URL', 'http://localhost:4200')
    .option('--status <status>', 'Filter meetings by status')
    .action(async (resource, options) => {
      if (resource !== 'agents' && resource !== 'meetings') {
        console.error('Resource must be "agents" or "meetings"');
        process.exit(1);
      }

      try {
        if (resource === 'agents') {
          const response = await fetch(`${options.server}/agents`);
          const agents = (await response.json()) as Array<{
            id: string;
            name: string;
            type: string;
            capabilities: string[];
          }>;

          console.log(`Agents (${agents.length}):`);
          for (const a of agents) {
            console.log(`  ${a.id} — ${a.name} [${a.type}]`);
            console.log(`    Capabilities: ${a.capabilities.join(', ') || '(none)'}`);
          }
        } else {
          const statusParam = options.status ? `?status=${options.status}` : '';
          const response = await fetch(`${options.server}/meetings${statusParam}`);
          const meetings = (await response.json()) as Array<{
            id: string;
            topic: string;
            status: string;
            createdAt: number;
          }>;

          console.log(`Meetings (${meetings.length}):`);
          for (const m of meetings) {
            const date = new Date(m.createdAt).toISOString();
            console.log(`  ${m.id} — "${m.topic}" [${m.status}] ${date}`);
          }
        }
      } catch {
        console.error('Failed to connect — is the server running?');
        process.exit(1);
      }
    });
}
