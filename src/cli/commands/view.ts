import { Command } from 'commander';

export function viewCommand(): Command {
  return new Command('view')
    .description('View meeting details, transcript, and summary')
    .argument('<meeting-id>', 'Meeting ID to view')
    .option('-s, --server <url>', 'Server URL', 'http://localhost:4200')
    .action(async (meetingId, options) => {
      try {
        const response = await fetch(`${options.server}/meetings/${meetingId}`);
        if (!response.ok) {
          console.error('Meeting not found');
          process.exit(1);
        }

        const meeting = (await response.json()) as {
          id: string;
          topic: string;
          context: string;
          status: string;
          participantIds: string[];
          moderatorId: string;
          transcript: Array<{
            authorName: string;
            content: string;
            phase: string;
            timestamp: number;
          }>;
          summary: {
            consensus: string;
            keyPoints: string[];
            dissentingViews: string[];
            actionItems: string[];
            voteTally?: Record<string, number>;
          } | null;
          createdAt: number;
          concludedAt: number | null;
        };

        console.log(`Meeting: ${meeting.id}`);
        console.log(`Topic: ${meeting.topic}`);
        console.log(`Status: ${meeting.status}`);
        console.log(`Participants: ${meeting.participantIds.join(', ')}`);
        console.log(`Moderator: ${meeting.moderatorId}`);
        console.log(`Created: ${new Date(meeting.createdAt).toISOString()}`);
        if (meeting.concludedAt) {
          console.log(`Concluded: ${new Date(meeting.concludedAt).toISOString()}`);
        }
        if (meeting.context) {
          console.log(`\nContext:\n${meeting.context}`);
        }

        if (meeting.summary) {
          console.log('\n--- SUMMARY ---');
          console.log(`Consensus: ${meeting.summary.consensus}`);
          console.log('\nKey Points:');
          for (const p of meeting.summary.keyPoints) {
            console.log(`  • ${p}`);
          }
          if (meeting.summary.dissentingViews.length > 0) {
            console.log('\nDissenting Views:');
            for (const v of meeting.summary.dissentingViews) {
              console.log(`  • ${v}`);
            }
          }
          if (meeting.summary.actionItems.length > 0) {
            console.log('\nAction Items:');
            for (const a of meeting.summary.actionItems) {
              console.log(`  • ${a}`);
            }
          }
          if (meeting.summary.voteTally) {
            console.log(
              `\nVote: YES=${meeting.summary.voteTally.yes ?? 0} NO=${meeting.summary.voteTally.no ?? 0} ABSTAIN=${meeting.summary.voteTally.abstain ?? 0}`
            );
          }
        }

        if (meeting.transcript.length > 0) {
          console.log('\n--- TRANSCRIPT ---');
          for (const msg of meeting.transcript) {
            const time = new Date(msg.timestamp).toLocaleTimeString();
            console.log(`[${time}] ${msg.authorName} (${msg.phase}):`);
            console.log(msg.content.slice(0, 500));
            console.log('---');
          }
        }
      } catch {
        console.error('Failed to connect — is the server running?');
        process.exit(1);
      }
    });
}
