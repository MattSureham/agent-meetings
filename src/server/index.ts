import { createServer as createHTTPServer } from 'node:http';
import { loadConfig } from '../config/loader.js';
import { JsonFileStore } from '../persistence/json-store.js';
import { AgentRegistry } from './agent-registry.js';
import { createRouter } from './http-routes.js';
import { setupWebSocket } from './websocket.js';

export interface ServerInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
  registry: AgentRegistry;
}

export async function createServer(configPath?: string): Promise<ServerInstance> {
  const config = loadConfig(configPath);
  const store = new JsonFileStore(config.server.dataDir);
  await store.init();

  const registry = new AgentRegistry(store);
  await registry.boot(config);

  const router = createRouter(registry, store, config);
  const httpServer = createHTTPServer(router);

  const wss = setupWebSocket(httpServer, registry);

  return {
    start(): Promise<void> {
      return new Promise((resolve) => {
        httpServer.listen(config.server.port, config.server.host, () => {
          console.log(`Agent Meetings server listening on http://${config.server.host}:${config.server.port}`);
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      return new Promise((resolve) => {
        wss.close(() => {
          httpServer.close(() => {
            registry.shutdown().then(resolve).catch(resolve);
          });
        });
      });
    },

    registry,
  };
}
