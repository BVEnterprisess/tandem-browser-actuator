import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { apiCall, getMcpSource, logActivity } from '../api-client.js';
import { coerceShape } from '../coerce.js';

function buildAgentChatBody(text: string): { text: string; from?: string } {
  const source = getMcpSource();
  return source === 'wingman' ? { text } : { text, from: source };
}

export function registerChatTools(server: McpServer): void {
  server.tool(
    'tandem_send_message',
    'Send a message that appears in the Wingman chat panel (visible to the human)',
    {
      text: z.string().describe('Message text to display'),
    },
    async ({ text }) => {
      await apiCall('POST', '/chat', buildAgentChatBody(text));
      return { content: [{ type: 'text', text: `Message sent: "${text.substring(0, 100)}"` }] };
    }
  );

  server.tool(
    'tandem_chat_reply',
    'Reply into the Wingman chat panel as the connected agent through Tandem local chat',
    {
      text: z.string().describe('Reply text to display in the Wingman chat'),
    },
    async ({ text }) => {
      await apiCall('POST', '/chat/messages', buildAgentChatBody(text));
      return { content: [{ type: 'text', text: `Reply sent: "${text.substring(0, 100)}"` }] };
    }
  );

  server.tool(
    'tandem_get_chat_history',
    'Get recent chat messages from the Wingman panel',
    coerceShape({
      limit: z.number().optional().default(20).describe('Number of messages to return (default: 20)'),
    }),
    async ({ limit }) => {
      const data = await apiCall('GET', `/chat?limit=${limit}`);
      const messages: Array<{ from: string; text: string; timestamp: number }> = data.messages || [];

      let text = `Chat history (${messages.length} messages):\n\n`;
      for (const msg of messages) {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        text += `[${time}] ${msg.from}: ${msg.text}\n`;
      }

      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'tandem_chat_wait_for_message',
    'Wait for new Wingman chat messages after a known message id',
    coerceShape({
      sinceId: z.number().optional().default(0).describe('Only return messages with id greater than this value'),
      timeoutMs: z.number().optional().default(30000).describe('Maximum wait in milliseconds, capped by Tandem'),
    }),
    async ({ sinceId, timeoutMs }) => {
      const data = await apiCall('GET', `/chat/wait?since_id=${sinceId}&timeout_ms=${timeoutMs}`);
      const messages: Array<{ id: number; from: string; text: string; timestamp: number }> = data.messages || [];

      if (messages.length === 0) {
        return { content: [{ type: 'text', text: data.timedOut ? 'No new chat messages before timeout.' : 'No new chat messages.' }] };
      }

      let text = `New chat messages (${messages.length}):\n\n`;
      for (const msg of messages) {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        text += `#${msg.id} [${time}] ${msg.from}: ${msg.text}\n`;
      }

      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'tandem_chat_set_typing',
    'Set the Wingman typing indicator in the chat panel',
    {
      typing: z.boolean().describe('Whether the Wingman typing indicator should be shown'),
    },
    async ({ typing }) => {
      await apiCall('POST', '/chat/typing', { typing });
      return { content: [{ type: 'text', text: `Typing indicator ${typing ? 'enabled' : 'disabled'}.` }] };
    }
  );

  server.tool(
    'tandem_chat_status',
    'Get Tandem local chat bus status for MCP/API Wingman chat',
    async () => {
      const data = await apiCall('GET', '/chat/status');
      return {
        content: [{
          type: 'text',
          text: `Tandem chat status: ${data.available ? 'available' : 'unavailable'} (backend: ${data.backend || 'unknown'}, lastMessageId: ${data.lastMessageId ?? 0})`,
        }],
      };
    }
  );

  server.tool(
    'tandem_get_context',
    'Get a comprehensive overview of the current browser state: active tab, open tabs, recent chat, and voice status',
    async () => {
      const [status, tabsData, chatData] = await Promise.all([
        apiCall('GET', '/status'),
        apiCall('GET', '/tabs/list'),
        apiCall('GET', '/chat?limit=5'),
      ]);

      const tabs: Array<{ id: string; title: string; url: string; active: boolean }> = tabsData.tabs || [];
      const messages: Array<{ from: string; text: string }> = chatData.messages || [];

      let text = `=== Browser Context ===\n\n`;

      // Active tab
      text += `Active tab: ${status.title || 'Unknown'}\n`;
      text += `URL: ${status.url || 'None'}\n`;
      text += `Loading: ${status.loading ? 'Yes' : 'No'}\n\n`;

      // All tabs
      text += `Open tabs (${tabs.length}):\n`;
      for (const tab of tabs) {
        const marker = tab.active ? '→ ' : '  ';
        text += `${marker}[${tab.id}] ${tab.title || '(untitled)'} — ${tab.url}\n`;
      }

      // Recent chat
      if (messages.length > 0) {
        text += `\nRecent chat:\n`;
        for (const msg of messages.slice(-5)) {
          text += `  ${msg.from}: ${msg.text.substring(0, 100)}\n`;
        }
      }

      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'tandem_wingman_alert',
    'Legacy compatibility alert: show a native Wingman alert and create an open needs_human handoff for the user',
    {
      message: z.string().describe('Alert message to display'),
      level: z.enum(['info', 'warning', 'error']).optional().describe('Alert level (default: info)'),
    },
    async ({ message, level }) => {
      const title = level === 'error' ? 'Error' : level === 'warning' ? 'Warning' : 'Info';
      await apiCall('POST', '/wingman-alert', { title, body: message });
      await logActivity('wingman_alert', `[${level || 'info'}] ${message.substring(0, 80)}`);
      return { content: [{ type: 'text', text: `Alert sent: [${level || 'info'}] ${message}` }] };
    }
  );
}
