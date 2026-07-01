/**
 * Pairing routes — setup code generation, exchange, and binding management.
 *
 * Public routes (no auth): /pairing/exchange
 * Binding-token routes: /pairing/whoami
 * Protected routes (local api-token): everything else
 */

import type { Router, Request, Response } from 'express';
import type { RouteContext } from '../context';
import { createRateLimitMiddleware } from '../rate-limit';
import { handleRouteError } from '../../utils/errors';
import { API_PORT } from '../../utils/constants';
import { detectApiAddresses } from '../../config/api-endpoints';
import {
  AGENT_OPERATING_RULES,
  AGENT_STARTUP_SEQUENCE,
  withBaseUrl,
} from '../agent-bootstrap';

const exchangeRateLimit = createRateLimitMiddleware({
  bucket: 'pairing-exchange',
  windowMs: 60_000,
  max: 10,
  message: 'Too many pairing attempts. Retry shortly.',
});

/** Detect the best connection addresses for local and Tailscale modes. */
export function detectAddresses(opts?: { apiPort?: number; apiListenHost?: string }) {
  return detectApiAddresses({
    apiPort: opts?.apiPort ?? API_PORT,
    apiListenHost: opts?.apiListenHost ?? '0.0.0.0',
  });
}

export function registerPairingRoutes(router: Router, ctx: RouteContext): void {
  const getBaseUrl = (req: Request): string => {
    const apiPort = ctx.configManager.getConfig().general?.apiPort ?? API_PORT;
    const host = req.headers.host ?? `127.0.0.1:${apiPort}`;
    return `http://${host}`;
  };

  // ═══════════════════════════════════════════════
  // GET /pairing/addresses — detect local + Tailscale addresses
  // ═══════════════════════════════════════════════

  router.get('/pairing/addresses', (_req: Request, res: Response) => {
    const config = ctx.configManager.getConfig();
    res.json(detectAddresses({
      apiPort: config.general?.apiPort ?? API_PORT,
      apiListenHost: config.general?.apiListenHost ?? '0.0.0.0',
    }));
  });

  // ═══════════════════════════════════════════════
  // POST /pairing/setup-code — generate one-time code
  // ═══════════════════════════════════════════════

  router.post('/pairing/setup-code', (_req: Request, res: Response) => {
    try {
      const setupCode = ctx.pairingManager.generateSetupCode();
      res.json({
        code: setupCode.code,
        expiresAt: new Date(setupCode.expiresAt).toISOString(),
        ttlSeconds: Math.max(0, Math.floor((setupCode.expiresAt - Date.now()) / 1000)),
      });
    } catch (e) {
      if (e instanceof Error && e.message.includes('Too many')) {
        res.status(429).json({ error: e.message });
        return;
      }
      handleRouteError(res, e);
    }
  });

  // ═══════════════════════════════════════════════
  // GET /pairing/setup-code/active — get current active code
  // ═══════════════════════════════════════════════

  router.get('/pairing/setup-code/active', (_req: Request, res: Response) => {
    const active = ctx.pairingManager.getActiveSetupCode();
    if (!active) {
      res.json(null);
      return;
    }
    res.json({
      code: active.code,
      expiresAt: new Date(active.expiresAt).toISOString(),
      ttlSeconds: Math.max(0, Math.floor((active.expiresAt - Date.now()) / 1000)),
    });
  });

  // ═══════════════════════════════════════════════
  // POST /pairing/exchange — exchange setup code for token (PUBLIC)
  // ═══════════════════════════════════════════════

  router.post('/pairing/exchange', exchangeRateLimit, (req: Request, res: Response) => {
    try {
      const { code, machineId, machineName, agentLabel, agentType, bindingKind, transport } = req.body;

      if (!code || typeof code !== 'string') {
        res.status(400).json({ error: 'code is required' });
        return;
      }
      if (!machineId || typeof machineId !== 'string') {
        res.status(400).json({ error: 'machineId is required' });
        return;
      }
      if (!machineName || typeof machineName !== 'string') {
        res.status(400).json({ error: 'machineName is required' });
        return;
      }
      if (!agentLabel || typeof agentLabel !== 'string') {
        res.status(400).json({ error: 'agentLabel is required' });
        return;
      }
      if (!agentType || typeof agentType !== 'string') {
        res.status(400).json({ error: 'agentType is required' });
        return;
      }

      // Validate setup code format
      const normalizedCode = code.toUpperCase().trim();
      if (!/^TDM-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizedCode)) {
        res.status(400).json({ error: 'Invalid setup code format. Expected TDM-XXXX-XXXX' });
        return;
      }

      const sourceIp = req.socket.remoteAddress ?? null;
      const result = ctx.pairingManager.exchangeSetupCode({
        code: normalizedCode,
        machineId,
        machineName,
        agentLabel,
        agentType,
        bindingKind: bindingKind === 'remote' ? 'remote' : 'local',
        transport: Array.isArray(transport) ? transport.filter((t: string) => t === 'http' || t === 'mcp') : ['http'],
      }, sourceIp);

      const transportModes: string[] = Array.isArray(transport)
        ? transport.filter((t: string) => t === 'http' || t === 'mcp')
        : ['http'];
      const baseUrl = getBaseUrl(req);

      const response: Record<string, unknown> = {
        token: result.token,
        binding: {
          id: result.binding.id,
          agentLabel: result.binding.agentLabel,
          agentType: result.binding.agentType,
          bindingKind: result.binding.bindingKind,
          state: result.binding.state,
        },
        bootstrap: {
          message: 'Connection succeeded. Read these resources with this Bearer token before using Tandem as a browser.',
          enforcement: {
            enabled: true,
            behavior: 'Most authenticated API and MCP routes return HTTP 428 until /skill, /agent/manifest, and /agent/bootstrap have been read with this binding token.',
          },
          nextRequiredReads: withBaseUrl(baseUrl, AGENT_STARTUP_SEQUENCE),
          recommendedWorkflow: 'snapshot-first explicit tab targeting',
          operatingRules: AGENT_OPERATING_RULES,
          docs: {
            humanReadable: `${baseUrl}/agent`,
            llmSkill: `${baseUrl}/skill`,
            machineManifest: `${baseUrl}/agent/manifest`,
            authenticatedBootstrap: `${baseUrl}/agent/bootstrap`,
          },
        },
      };

      // Include MCP connection details when MCP transport is requested
      if (transportModes.includes('mcp')) {
        response.mcp = {
          endpoint: '/mcp',
          transport: 'streamable-http',
        };
      }

      res.json(response);
    } catch (e) {
      if (e instanceof Error) {
        if (e.message.includes('Invalid setup code') || e.message.includes('already been used') || e.message.includes('expired')) {
          res.status(400).json({ error: e.message });
          return;
        }
      }
      handleRouteError(res, e);
    }
  });

  // ═══════════════════════════════════════════════
  // GET /pairing/whoami — validate token, return binding info
  // ═══════════════════════════════════════════════

  router.get('/pairing/whoami', (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Authorization: Bearer <token> required' });
      return;
    }

    const token = authHeader.slice(7).trim();
    const binding = ctx.pairingManager.whoami(token);
    if (!binding) {
      res.status(401).json({ error: 'Invalid or inactive binding token' });
      return;
    }

    res.json(binding);
  });

  // ═══════════════════════════════════════════════
  // GET /pairing/bindings — list all bindings
  // ═══════════════════════════════════════════════

  router.get('/pairing/bindings', (_req: Request, res: Response) => {
    res.json(ctx.pairingManager.listBindings());
  });

  // ═══════════════════════════════════════════════
  // POST /pairing/bindings/:id/pause
  // ═══════════════════════════════════════════════

  router.post('/pairing/bindings/:id/pause', (req: Request, res: Response) => {
    const result = ctx.pairingManager.pauseBinding(req.params.id as string);
    if (!result) {
      res.status(404).json({ error: 'Binding not found or not in paired state' });
      return;
    }
    res.json({ success: true, state: result.state });
  });

  // ═══════════════════════════════════════════════
  // POST /pairing/bindings/:id/resume
  // ═══════════════════════════════════════════════

  router.post('/pairing/bindings/:id/resume', (req: Request, res: Response) => {
    const result = ctx.pairingManager.resumeBinding(req.params.id as string);
    if (!result) {
      res.status(404).json({ error: 'Binding not found or not in paused state' });
      return;
    }
    res.json({ success: true, state: result.state });
  });

  // ═══════════════════════════════════════════════
  // POST /pairing/bindings/:id/revoke
  // ═══════════════════════════════════════════════

  router.post('/pairing/bindings/:id/revoke', (req: Request, res: Response) => {
    const result = ctx.pairingManager.revokeBinding(req.params.id as string);
    if (!result) {
      res.status(404).json({ error: 'Binding not found or already revoked' });
      return;
    }
    res.json({ success: true, state: result.state });
  });

  // ═══════════════════════════════════════════════
  // DELETE /pairing/bindings/:id — remove from active list
  // ═══════════════════════════════════════════════

  router.delete('/pairing/bindings/:id', (req: Request, res: Response) => {
    const result = ctx.pairingManager.removeBinding(req.params.id as string);
    if (!result) {
      res.status(404).json({ error: 'Binding not found' });
      return;
    }
    res.json({ success: true });
  });
}
