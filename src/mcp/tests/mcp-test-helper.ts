/**
 * Shared test helper for MCP tool tests.
 *
 * Creates a mock McpServer that captures tool registrations so handlers
 * can be invoked directly in tests without spinning up a real server.
 */
import { vi, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface RegisteredTool {
  name: string;
  description: string;
  handler: (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }>;
}

/**
 * Build a mock McpServer whose `.tool()` captures every registration.
 * Returns the mock and a map from tool-name → handler.
 */
export function createMockServer() {
  const tools = new Map<string, RegisteredTool>();

  const server = {
    tool: vi.fn((...args: unknown[]) => {
      const name = args[0] as string;
      const description = args[1] as string;
      // The handler is always the last argument
      const handler = args[args.length - 1] as RegisteredTool['handler'];
      tools.set(name, { name, description, handler });
    }),
  } as unknown as McpServer;

  return { server, tools };
}

/** Retrieve a handler by name or throw if missing. */
export function getHandler(tools: Map<string, RegisteredTool>, name: string) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool "${name}" not registered`);
  return tool.handler;
}

/** Assert the standard MCP text response shape. */
export function expectTextContent(
  result: { content: Array<{ type: string; text?: string }> },
  substring?: string,
) {
  expect(result).toHaveProperty('content');
  expect(Array.isArray(result.content)).toBe(true);
  expect(result.content[0]).toHaveProperty('type', 'text');
  expect(result.content[0]).toHaveProperty('text');
  if (substring) {
    expect(result.content[0].text).toContain(substring);
  }
  return result.content[0].text as string;
}

/** Assert the standard MCP image response shape. */
export function expectImageContent(
  result: { content: Array<{ type: string; data?: string; mimeType?: string }> },
  mimeType = 'image/png',
) {
  expect(result).toHaveProperty('content');
  expect(result.content[0]).toHaveProperty('type', 'image');
  expect(result.content[0]).toHaveProperty('data');
  expect(result.content[0]).toHaveProperty('mimeType', mimeType);
  return result.content[0].data as string;
}
