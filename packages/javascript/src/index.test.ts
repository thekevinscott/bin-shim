import { describe, it, expect } from 'vitest';
import * as lib from './index.js';

describe('public API barrel', () => {
  it('exports the spawn strategy', () => {
    expect(typeof lib.main).toBe('function');
    expect(typeof lib.resolveBinary).toBe('function');
    expect(typeof lib.defaultResolver).toBe('function');
    expect(typeof lib.defaultSpawner).toBe('function');
  });

  it('exports the in-process strategy', () => {
    expect(typeof lib.mainInProcess).toBe('function');
    expect(typeof lib.resolveRunCli).toBe('function');
    expect(typeof lib.applyExitSemantics).toBe('function');
    expect(typeof lib.flushStdio).toBe('function');
    expect(typeof lib.defaultLoader).toBe('function');
    expect(typeof lib.defaultSignalRaiser).toBe('function');
  });

  it('exports the 128 + N shutdown codes', () => {
    expect(lib.SIGINT_EXIT_CODE).toBe(130);
    expect(lib.SIGTERM_EXIT_CODE).toBe(143);
  });
});
