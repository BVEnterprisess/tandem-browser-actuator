import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../utils/logger';
import type { WatchLiveEvent, WatchManager } from './watcher';

const log = createLogger('WatchLiveWS');
const HEARTBEAT_INTERVAL_MS = 30_000;

interface WatchSocket extends WebSocket {
  isAlive?: boolean;
}

export interface WatchLiveWebSocketOptions {
  authorizeRequest: (req: IncomingMessage) => boolean;
}

/**
 * WatchLiveWebSocket — pushes watch snapshots and incremental updates to agents.
 */
export class WatchLiveWebSocket {
  private readonly wss: WebSocketServer;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly handleUpgradeBound: (req: IncomingMessage, socket: Socket, head: Buffer) => void;

  constructor(
    private readonly httpServer: HttpServer,
    private readonly watchManager: WatchManager,
    private readonly opts: WatchLiveWebSocketOptions,
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    this.handleUpgradeBound = this.handleUpgrade.bind(this);

    this.httpServer.on('upgrade', this.handleUpgradeBound);
    this.wss.on('connection', (ws) => {
      this.handleConnection(ws as WatchSocket);
    });

    this.heartbeat = setInterval(() => {
      for (const client of this.wss.clients) {
        const socket = client as WatchSocket;
        if (!socket.isAlive) {
          socket.terminate();
          continue;
        }
        socket.isAlive = false;
        if (socket.readyState === WebSocket.OPEN) {
          socket.ping();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);

    log.info('Watch live WebSocket ready on /watch/live');
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.httpServer.off('upgrade', this.handleUpgradeBound);
    for (const client of this.wss.clients) {
      client.close(1001, 'Server shutting down');
    }
    this.wss.close();
  }

  private handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    const url = new URL(req.url ?? '', 'http://localhost');
    if (url.pathname !== '/watch/live') return;

    if (!this.opts.authorizeRequest(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
  }

  private handleConnection(ws: WatchSocket): void {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    this.sendEvent(ws, this.watchManager.getSnapshot());

    const unsubscribe = this.watchManager.subscribe((event) => {
      this.sendEvent(ws, event);
    });

    ws.on('close', () => {
      unsubscribe();
    });

    ws.on('error', () => {
      unsubscribe();
    });
  }

  private sendEvent(ws: WebSocket, event: WatchLiveEvent): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(event));
  }
}
