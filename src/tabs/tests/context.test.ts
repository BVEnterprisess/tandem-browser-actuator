import { describe, it, expect } from 'vitest';
import {
  normalizeTabSource,
  getActorContext,
  buildTabOwnershipContext,
} from '../context';

describe('normalizeTabSource', () => {
  it('returns null for non-string input', () => {
    expect(normalizeTabSource(null)).toBeNull();
    expect(normalizeTabSource(undefined)).toBeNull();
    expect(normalizeTabSource(42)).toBeNull();
    expect(normalizeTabSource({})).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeTabSource('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(normalizeTabSource('   ')).toBeNull();
  });

  it('returns trimmed string for valid input', () => {
    expect(normalizeTabSource('claude')).toBe('claude');
    expect(normalizeTabSource('  user  ')).toBe('user');
    expect(normalizeTabSource('wingman')).toBe('wingman');
  });
});

describe('getActorContext', () => {
  it('returns unknown kind for null/empty source', () => {
    expect(getActorContext(null)).toEqual({ id: null, kind: 'unknown' });
    expect(getActorContext('')).toEqual({ id: null, kind: 'unknown' });
    expect(getActorContext(undefined)).toEqual({ id: null, kind: 'unknown' });
  });

  it('returns human kind for user source', () => {
    expect(getActorContext('user')).toEqual({ id: 'user', kind: 'human' });
  });

  it('returns assistant kind for wingman source', () => {
    expect(getActorContext('wingman')).toEqual({ id: 'wingman', kind: 'assistant' });
  });

  it('returns agent kind for any other source', () => {
    expect(getActorContext('claude')).toEqual({ id: 'claude', kind: 'agent' });
    expect(getActorContext('codex')).toEqual({ id: 'codex', kind: 'agent' });
    expect(getActorContext('my-agent')).toEqual({ id: 'my-agent', kind: 'agent' });
  });
});

describe('buildTabOwnershipContext', () => {
  it('builds context with all fields populated', () => {
    const ctx = buildTabOwnershipContext({
      source: 'claude',
      workspaceId: 'ws-1',
      workspaceName: 'Claude WS',
      selectedWorkspaceId: 'ws-1',
      selectedWorkspaceName: 'Claude WS',
      scope: 'tab',
    });

    expect(ctx).toEqual({
      scope: 'tab',
      source: 'claude',
      actor: { id: 'claude', kind: 'agent' },
      workspace: {
        id: 'ws-1',
        name: 'Claude WS',
        selectedId: 'ws-1',
        selectedName: 'Claude WS',
        matchesSelection: true,
      },
    });
  });

  it('sets matchesSelection to false when workspace IDs differ', () => {
    const ctx = buildTabOwnershipContext({
      source: 'claude',
      workspaceId: 'ws-1',
      selectedWorkspaceId: 'ws-2',
    });

    expect(ctx.workspace.matchesSelection).toBe(false);
  });

  it('sets matchesSelection to null when workspaceId is null', () => {
    const ctx = buildTabOwnershipContext({
      source: 'user',
      workspaceId: null,
      selectedWorkspaceId: 'ws-1',
    });

    expect(ctx.workspace.matchesSelection).toBeNull();
  });

  it('defaults scope to tab when not specified', () => {
    const ctx = buildTabOwnershipContext({});
    expect(ctx.scope).toBe('tab');
  });

  it('uses global scope when specified', () => {
    const ctx = buildTabOwnershipContext({ scope: 'global' });
    expect(ctx.scope).toBe('global');
  });

  it('handles missing/null source as unknown actor', () => {
    const ctx = buildTabOwnershipContext({ source: null });
    expect(ctx.source).toBeNull();
    expect(ctx.actor).toEqual({ id: null, kind: 'unknown' });
  });

  it('handles user source as human actor', () => {
    const ctx = buildTabOwnershipContext({ source: 'user' });
    expect(ctx.actor).toEqual({ id: 'user', kind: 'human' });
  });

  it('handles wingman source as assistant actor', () => {
    const ctx = buildTabOwnershipContext({ source: 'wingman' });
    expect(ctx.actor).toEqual({ id: 'wingman', kind: 'assistant' });
  });

  it('nullifies all workspace fields when omitted', () => {
    const ctx = buildTabOwnershipContext({});
    expect(ctx.workspace).toEqual({
      id: null,
      name: null,
      selectedId: null,
      selectedName: null,
      matchesSelection: null,
    });
  });
});
