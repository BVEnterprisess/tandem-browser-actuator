import { describe, it, expect, vi } from 'vitest';
import { buildOwnershipContextForTab, buildOwnershipContextForTabId } from '../runtime-context';

function createMockWorkspaceManager(overrides: Record<string, unknown> = {}) {
  return {
    getActive: vi.fn().mockReturnValue({ id: 'ws-default', name: 'Default' }),
    getWorkspaceIdForTab: vi.fn().mockReturnValue(null),
    get: vi.fn().mockReturnValue(null),
    ...overrides,
  } as any;
}

function createMockTabManager(overrides: Record<string, unknown> = {}) {
  return {
    getTab: vi.fn().mockReturnValue(null),
    ...overrides,
  } as any;
}

describe('buildOwnershipContextForTab', () => {
  it('returns global-scope unknown context when tab is null', () => {
    const wm = createMockWorkspaceManager();
    const ctx = buildOwnershipContextForTab(wm, null);

    expect(ctx.scope).toBe('tab');
    expect(ctx.source).toBeNull();
    expect(ctx.actor).toEqual({ id: null, kind: 'unknown' });
    expect(ctx.workspace.id).toBeNull();
    expect(ctx.workspace.selectedId).toBe('ws-default');
  });

  it('builds context for a tab with a source and workspace', () => {
    const wm = createMockWorkspaceManager({
      getActive: vi.fn().mockReturnValue({ id: 'ws-1', name: 'Codex WS' }),
      getWorkspaceIdForTab: vi.fn().mockReturnValue('ws-1'),
      get: vi.fn().mockReturnValue({ id: 'ws-1', name: 'Codex WS' }),
    });

    const tab = { webContentsId: 100, source: 'claude' };
    const ctx = buildOwnershipContextForTab(wm, tab);

    expect(ctx.scope).toBe('tab');
    expect(ctx.source).toBe('claude');
    expect(ctx.actor).toEqual({ id: 'claude', kind: 'agent' });
    expect(ctx.workspace.id).toBe('ws-1');
    expect(ctx.workspace.name).toBe('Codex WS');
    expect(ctx.workspace.selectedId).toBe('ws-1');
    expect(ctx.workspace.matchesSelection).toBe(true);
  });

  it('sets matchesSelection to false when tab workspace differs from selected', () => {
    const wm = createMockWorkspaceManager({
      getActive: vi.fn().mockReturnValue({ id: 'ws-selected', name: 'Selected' }),
      getWorkspaceIdForTab: vi.fn().mockReturnValue('ws-tab'),
      get: vi.fn().mockReturnValue({ id: 'ws-tab', name: 'Tab WS' }),
    });

    const tab = { webContentsId: 200, source: 'user' };
    const ctx = buildOwnershipContextForTab(wm, tab);

    expect(ctx.workspace.id).toBe('ws-tab');
    expect(ctx.workspace.selectedId).toBe('ws-selected');
    expect(ctx.workspace.matchesSelection).toBe(false);
  });

  it('respects the scope override', () => {
    const wm = createMockWorkspaceManager();
    const ctx = buildOwnershipContextForTab(wm, null, 'global');
    expect(ctx.scope).toBe('global');
  });

  it('handles tab with no workspace assignment', () => {
    const wm = createMockWorkspaceManager({
      getWorkspaceIdForTab: vi.fn().mockReturnValue(null),
    });

    const tab = { webContentsId: 300, source: 'user' };
    const ctx = buildOwnershipContextForTab(wm, tab);

    expect(ctx.workspace.id).toBeNull();
    expect(ctx.workspace.name).toBeNull();
  });
});

describe('buildOwnershipContextForTabId', () => {
  it('returns unknown context when tabId is undefined', () => {
    const wm = createMockWorkspaceManager();
    const tm = createMockTabManager();
    const ctx = buildOwnershipContextForTabId(tm, wm, undefined);

    expect(ctx.source).toBeNull();
    expect(ctx.actor.kind).toBe('unknown');
  });

  it('returns unknown context when tab is not found', () => {
    const wm = createMockWorkspaceManager();
    const tm = createMockTabManager({ getTab: vi.fn().mockReturnValue(null) });
    const ctx = buildOwnershipContextForTabId(tm, wm, 'nonexistent-tab');

    expect(ctx.source).toBeNull();
    expect(ctx.actor.kind).toBe('unknown');
  });

  it('builds full context when tab is found', () => {
    const wm = createMockWorkspaceManager({
      getActive: vi.fn().mockReturnValue({ id: 'ws-1', name: 'Work' }),
      getWorkspaceIdForTab: vi.fn().mockReturnValue('ws-1'),
      get: vi.fn().mockReturnValue({ id: 'ws-1', name: 'Work' }),
    });
    const tm = createMockTabManager({
      getTab: vi.fn().mockReturnValue({ webContentsId: 42, source: 'wingman' }),
    });

    const ctx = buildOwnershipContextForTabId(tm, wm, 'tab-42');

    expect(ctx.source).toBe('wingman');
    expect(ctx.actor).toEqual({ id: 'wingman', kind: 'assistant' });
    expect(ctx.workspace.id).toBe('ws-1');
  });

  it('respects the scope parameter', () => {
    const wm = createMockWorkspaceManager();
    const tm = createMockTabManager();
    const ctx = buildOwnershipContextForTabId(tm, wm, undefined, 'global');
    expect(ctx.scope).toBe('global');
  });
});
