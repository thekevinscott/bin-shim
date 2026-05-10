import { describe, it, expect } from 'vitest';
import * as lib from './index.js';

describe('public API barrel', () => {
  it('exports main, resolveBinary, defaultResolver, defaultSpawner', () => {
    expect(typeof lib.main).toBe('function');
    expect(typeof lib.resolveBinary).toBe('function');
    expect(typeof lib.defaultResolver).toBe('function');
    expect(typeof lib.defaultSpawner).toBe('function');
  });
});
