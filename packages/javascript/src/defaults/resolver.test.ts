import { describe, it, expect } from 'vitest';
import { defaultResolver } from './resolver.js';

describe('defaultResolver', () => {
  it('returns a function that resolves Node built-ins', () => {
    const r = defaultResolver(import.meta.url);
    expect(typeof r('node:fs')).toBe('string');
  });
});
