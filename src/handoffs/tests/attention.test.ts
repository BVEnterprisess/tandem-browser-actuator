import { describe, expect, it } from 'vitest';
import { getHandoffAttentionLevel } from '../attention';

describe('getHandoffAttentionLevel', () => {
  it('maps actionable statuses to durable attention levels', () => {
    expect(getHandoffAttentionLevel({ status: 'needs_human', open: true } as any)).toBe('action');
    expect(getHandoffAttentionLevel({ status: 'blocked', open: true } as any)).toBe('urgent');
    expect(getHandoffAttentionLevel({ status: 'waiting_approval', open: true } as any)).toBe('urgent');
    expect(getHandoffAttentionLevel({ status: 'ready_to_resume', open: true } as any)).toBe('review');
    expect(getHandoffAttentionLevel({ status: 'completed_review', open: true } as any)).toBe('review');
  });

  it('returns none for resolved or closed handoffs', () => {
    expect(getHandoffAttentionLevel({ status: 'resolved', open: false } as any)).toBe('none');
    expect(getHandoffAttentionLevel({ status: 'needs_human', open: false } as any)).toBe('none');
  });
});
