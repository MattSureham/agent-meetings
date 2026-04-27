import type { Server as HTTPServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { ProtocolAgent } from '../agent/protocol/agent.js';
import type { AgentRegistry } from './agent-registry.js';

export function setupWebSocket(
  httpServer: HTTPServer,
  registry: AgentRegistry
): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);

    if (url.pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        handleConnection(ws, registry);
      });
    } else {
      socket.destroy();
    }
  });

  return wss;
}

function handleConnection(ws: WebSocket, registry: AgentRegistry): void {
  let agent: ProtocolAgent | null = null;

  const timeout = setTimeout(() => {
    if (!agent) {
      ws.close(4001, 'Registration timeout — agent must send register message within 10s');
    }
  }, 10_000);

  ws.on('message', (data) => {
    let msg: { type: string; [key: string]: unknown };

    try {
      msg = JSON.parse(data.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    switch (msg.type) {
      case 'register': {
        if (agent) {
          ws.send(JSON.stringify({ type: 'error', message: 'Already registered' }));
          return;
        }

        const id = String(msg.id ?? '');
        const name = String(msg.name ?? '');
        const capabilities = Array.isArray(msg.capabilities) ? msg.capabilities.map(String) : [];

        if (!id || !name) {
          ws.send(JSON.stringify({ type: 'error', message: 'Registration requires id and name' }));
          return;
        }

        if (registry.get(id)) {
          ws.send(JSON.stringify({ type: 'error', message: `Agent "${id}" is already registered` }));
          return;
        }

        agent = new ProtocolAgent(ws, id, name, capabilities);
        registry.register(agent);
        clearTimeout(timeout);

        ws.send(JSON.stringify({ type: 'registered', id }));

        ws.on('close', () => {
          if (agent) {
            registry.unregister(agent.id).catch(() => {});
          }
        });
        break;
      }

      case 'heartbeat': {
        if (agent) {
          ws.send(JSON.stringify({ type: 'heartbeat_ack' }));
        }
        break;
      }

      default: {
        // other message types handled by ProtocolAgent internally
        break;
      }
    }
  });

  ws.on('error', () => {
    if (agent) {
      registry.unregister(agent.id).catch(() => {});
    }
  });
}
