import { describe, it, expect } from 'vitest';
import { InteractionTargetNotFoundError } from '../errors';

describe('InteractionTargetNotFoundError', () => {
  it('is an instance of Error', () => {
    const err = new InteractionTargetNotFoundError('element not found');
    expect(err).toBeInstanceOf(Error);
  });

  it('has statusCode 404', () => {
    const err = new InteractionTargetNotFoundError('element not found');
    expect(err.statusCode).toBe(404);
  });

  it('sets the message correctly', () => {
    const err = new InteractionTargetNotFoundError('ref @e1 not found');
    expect(err.message).toBe('ref @e1 not found');
  });

  it('has the correct name property', () => {
    const err = new InteractionTargetNotFoundError('test');
    expect(err.name).toBe('InteractionTargetNotFoundError');
  });
});
