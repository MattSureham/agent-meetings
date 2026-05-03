import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { AgentRegistry } from './agent-registry.js';
import type { DataStore } from '../persistence/types.js';
import { MeetingEngine } from '../meeting/engine.js';
import type { Config } from '../config/types.js';
import type { IAgent } from '../agent/types.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const UI_DIR = join(import.meta.dirname, '..', '..', 'public');

interface RunningMeeting {
  engine: MeetingEngine;
  running: Promise<void> | null;
}

interface CreateMeetingBody {
  topic: string;
  context?: string;
  participantIds: string[];
  moderatorId?: string;
  autoStart?: boolean;
  mode?: 'debate' | 'collaboration';
  workDir?: string;
}

interface CreateAgentBody {
  id: string;
  name: string;
  capabilities?: string[];
  type?: string;
}

export function createRouter(
  registry: AgentRegistry,
  store: DataStore,
  config: Config
) {
  const meetings: Map<string, RunningMeeting> = new Map();

  return async function router(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';

    try {
      // Static file serving for the web UI
      if (method === 'GET' && (path === '/' || path === '/ui' || path.startsWith('/ui/'))) {
        let filePath = path === '/' || path === '/ui' ? '/index.html' : path.replace('/ui', '');
        const fullPath = join(UI_DIR, filePath);
        if (existsSync(fullPath)) {
          const ext = extname(fullPath);
          res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
          res.end(readFileSync(fullPath));
        } else {
          json(res, 404, { error: 'File not found' });
        }
        return;
      }

      if (method === 'GET' && path === '/health') {
        return json(res, 200, {
          status: 'ok',
          uptime: process.uptime(),
          agents: registry.list().length,
          activeMeetings: [...meetings.values()].filter(
            (m) => m.engine.status === 'active'
          ).length,
        });
      }

      if (method === 'GET' && path === '/agents') {
        return json(
          res,
          200,
          registry.list().map((a) => ({
            id: a.id,
            name: a.name,
            capabilities: a.capabilities,
            type: a.type,
          }))
        );
      }

      if (method === 'POST' && path === '/agents') {
        const body = await readBody<CreateAgentBody>(req);
        const agent = await store.saveAgent({
          id: body.id,
          name: body.name,
          capabilities: body.capabilities ?? [],
          type: body.type === 'subprocess' || body.type === 'llm' || body.type === 'protocol'
            ? body.type
            : 'protocol',
          status: 'online',
          lastHeartbeat: Date.now(),
          registeredAt: Date.now(),
        });
        return json(res, 201, agent);
      }

      if (method === 'DELETE' && path.startsWith('/agents/')) {
        const id = path.slice('/agents/'.length);
        await registry.unregister(id);
        return json(res, 200, { removed: id });
      }

      if (method === 'GET' && path === '/meetings') {
        const status = url.searchParams.get('status');
        const list = await store.listMeetings(
          status
            ? { status: status as 'active' | 'concluded' | 'pending' | 'cancelled' }
            : undefined
        );
        return json(res, 200, list);
      }

      if (method === 'POST' && path === '/meetings') {
        const body = await readBody<CreateMeetingBody>(req);

        if (!body.topic || !body.participantIds?.length) {
          return json(res, 400, { error: 'topic and participantIds are required' });
        }

        const participants = body.participantIds
          .map((id) => registry.get(id))
          .filter((a): a is IAgent => a != null);

        if (participants.length === 0) {
          return json(res, 400, { error: 'No available participants found' });
        }

        const moderatorId = body.moderatorId ?? config.meetings.defaultModerator;

        const engine = new MeetingEngine({
          topic: body.topic,
          context: body.context ?? '',
          participants,
          moderatorId,
          mode: body.mode ?? config.meetings.mode,
          workDir: body.workDir,
          turnTimeoutMs: config.meetings.turnTimeoutMs,
          maxRebuttalRounds: config.meetings.maxRebuttalRounds,
          maxDeliberationTurns: config.meetings.maxDeliberationTurns,
          maxTotalTurns: config.meetings.maxTotalTurns,
          defaultLLM: registry.getLLMAdapter(moderatorId) ?? undefined,
        });

        await store.saveMeeting(engine.toStoredMeeting());

        const running: RunningMeeting = { engine, running: null };
        meetings.set(engine.id, running);

        const autoStart = body.autoStart !== false;
        if (autoStart) {
          running.running = engine.start().then(() => {
            store.saveMeeting(engine.toStoredMeeting()).catch(() => {});
          });
        }

        return json(res, 201, { id: engine.id, topic: engine.topic, status: engine.status });
      }

      if (method === 'GET' && path.startsWith('/meetings/')) {
        const id = path.slice('/meetings/'.length);
        if (id === 'active') {
          const active = [...meetings.values()].filter(
            (m) => m.engine.status === 'active'
          );
          return json(
            res,
            200,
            active.map((m) => ({
              id: m.engine.id,
              topic: m.engine.topic,
              status: m.engine.status,
              phase: m.engine.currentPhase,
            }))
          );
        }

        const meeting = await store.getMeeting(id);

        // If the meeting is currently running, return live state from engine
        const running = meetings.get(id);
        if (running) {
          const stored = running.engine.toStoredMeeting();
          if (meeting) stored.summary = stored.summary ?? meeting.summary;
          return json(res, 200, stored);
        }

        if (!meeting) return json(res, 404, { error: 'Meeting not found' });
        return json(res, 200, meeting);
      }

      if (method === 'POST' && path.startsWith('/meetings/') && path.endsWith('/start')) {
        const id = path.slice('/meetings/'.length).replace('/start', '');
        const stored = await store.getMeeting(id);
        if (!stored) return json(res, 404, { error: 'Meeting not found' });
        if (stored.status !== 'pending') {
          return json(res, 400, { error: `Meeting is ${stored.status}, not pending` });
        }

        const participants = stored.participantIds
          .map((pid) => registry.get(pid))
          .filter((a): a is IAgent => a != null);

        const engine = new MeetingEngine({
          topic: stored.topic,
          context: stored.context,
          participants,
          moderatorId: stored.moderatorId,
          turnTimeoutMs: config.meetings.turnTimeoutMs,
          maxRebuttalRounds: config.meetings.maxRebuttalRounds,
          maxDeliberationTurns: config.meetings.maxDeliberationTurns,
          maxTotalTurns: config.meetings.maxTotalTurns,
          defaultLLM: registry.getLLMAdapter(stored.moderatorId) ?? undefined,
        });

        const running: RunningMeeting = { engine, running: null };
        meetings.set(engine.id, running);
        engine.status = 'active';
        running.running = engine.start().then(() => {
          store.saveMeeting(engine.toStoredMeeting()).catch(() => {});
        });

        return json(res, 200, { id: engine.id, status: 'active' });
      }

      if (method === 'POST' && path.startsWith('/meetings/') && path.endsWith('/cancel')) {
        const id = path.slice('/meetings/'.length).replace('/cancel', '');
        const running = meetings.get(id);
        if (running) {
          running.engine.cancel();
          await store.saveMeeting(running.engine.toStoredMeeting());
          return json(res, 200, { id, status: 'cancelled' });
        }

        const stored = await store.getMeeting(id);
        if (!stored) return json(res, 404, { error: 'Meeting not found' });
        stored.status = 'cancelled';
        await store.saveMeeting(stored);
        return json(res, 200, { id, status: 'cancelled' });
      }

      json(res, 404, { error: 'Not found' });
    } catch (e) {
      console.error('Request error:', e);
      json(res, 500, { error: 'Internal server error' });
    }
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody<T>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as T) : ({} as T));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}
