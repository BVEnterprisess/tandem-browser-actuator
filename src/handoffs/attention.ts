import type { Handoff } from './manager';

export const HANDOFF_ATTENTION_LEVELS = ['none', 'review', 'action', 'urgent'] as const;

export type HandoffAttentionLevel = (typeof HANDOFF_ATTENTION_LEVELS)[number];

const STATUS_TO_ATTENTION_LEVEL: Record<Handoff['status'], HandoffAttentionLevel> = {
  needs_human: 'action',
  blocked: 'urgent',
  waiting_approval: 'urgent',
  ready_to_resume: 'review',
  completed_review: 'review',
  resolved: 'none',
};

export function getHandoffAttentionLevel(handoff: Pick<Handoff, 'status' | 'open'>): HandoffAttentionLevel {
  if (!handoff.open || handoff.status === 'resolved') {
    return 'none';
  }
  return STATUS_TO_ATTENTION_LEVEL[handoff.status];
}
