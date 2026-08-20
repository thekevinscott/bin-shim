import { describe, it, expect } from 'vitest';
import * as defaults from './index.js';

describe('defaults barrel', () => {
  it('exports exactly the four default implementations', () => {
    expect(Object.keys(defaults).sort()).toEqual([
      'defaultLoader',
      'defaultResolver',
      'defaultSignalRaiser',
      'defaultSpawner',
    ]);
  });

  it('exports each as a function', () => {
    expect(defaults.defaultLoader).toBeTypeOf('function');
    expect(defaults.defaultResolver).toBeTypeOf('function');
    expect(defaults.defaultSignalRaiser).toBeTypeOf('function');
    expect(defaults.defaultSpawner).toBeTypeOf('function');
  });
});
