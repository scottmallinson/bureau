import { describe, expect, it } from 'vitest';
import { dispatchComposeLink, isDispatchComposeLink } from '../src/core/dispatch.js';

describe('Dispatch links', () => {
  it('builds a compose link with the time in UTC', () => {
    const link = dispatchComposeLink(new Date('2026-11-12T09:00:00.000Z'));
    expect(link).toBe('dispatch://compose?at=2026-11-12T09%3A00%3A00.000Z');
  });

  it('accepts the links it builds', () => {
    const link = dispatchComposeLink(new Date('2026-11-12T09:30:00.000Z'));
    expect(isDispatchComposeLink(link)).toBe(true);
  });

  it('refuses anything that is not a compose link', () => {
    const refused = [
      'https://example.com/?at=2026-11-12T09%3A00%3A00.000Z',
      'javascript:alert(1)',
      'dispatch://settings',
      'dispatch://compose',
      'dispatch://compose?at=2026-11-12T09%3A00%3A00.000Z&channel=x',
      'dispatch://compose?at=2026-11-12T09%3A00%3A00.000Z#x',
      'dispatch://compose?at=2026-11-12 09:00',
      ' dispatch://compose?at=2026-11-12T09%3A00%3A00.000Z',
    ];
    for (const link of refused) expect(isDispatchComposeLink(link)).toBe(false);
  });
});
