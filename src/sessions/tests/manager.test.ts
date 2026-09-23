import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromPartition } = vi.hoisted(() => ({
  fromPartition: vi.fn().mockReturnValue({ cookies: { set: vi.fn() } }),
}));

vi.mock('electron', () => ({
  session: { fromPartition },
}));

import { SessionManager } from '../manager';

describe('SessionManager.getOrCreate', () => {
  beforeEach(() => {
    fromPartition.mockClear();
  });

  it('returns the default session without creating a new partition', () => {
    const manager = new SessionManager();
    const first = manager.getOrCreate('default');
    const second = manager.getOrCreate('default');

    expect(first.created).toBe(false);
    expect(second.created).toBe(false);
    expect(first.session.partition).toBe('persist:tandem');
    expect(fromPartition).not.toHaveBeenCalled();
  });

  it('creates an isolated persist session once', () => {
    const manager = new SessionManager();
    const created = manager.getOrCreate('chrome-profile-6');
    const existing = manager.getOrCreate('chrome-profile-6');

    expect(created.created).toBe(true);
    expect(existing.created).toBe(false);
    expect(created.session.partition).toBe('persist:session-chrome-profile-6');
    expect(fromPartition).toHaveBeenCalledWith('persist:session-chrome-profile-6');
    expect(manager.electronSession('chrome-profile-6')).toEqual({ cookies: { set: expect.any(Function) } });
  });
});
