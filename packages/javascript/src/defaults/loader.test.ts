import { describe, it, expect } from 'vitest';
import { defaultLoader } from './loader.js';

describe('defaultLoader', () => {
  it('returns a require function bound to the given module URL', () => {
    const load = defaultLoader(import.meta.url);
    expect(typeof load).toBe('function');
    // node:path is always resolvable, and requiring it proves the returned
    // function really loads modules rather than just resolving paths.
    expect(load('node:path')).toHaveProperty('join');
  });

  it('throws for a module that cannot be resolved from `from`', () => {
    const load = defaultLoader(import.meta.url);
    expect(() => load('@definitely/not-installed-xyz')).toThrow();
  });
});
