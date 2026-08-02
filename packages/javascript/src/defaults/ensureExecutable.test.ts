import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return { ...actual, statSync: vi.fn(), chmodSync: vi.fn() };
});

import { chmodSync, statSync } from 'node:fs';
import { ensureExecutable } from './ensureExecutable.js';

describe('ensureExecutable', () => {
  beforeEach(() => {
    vi.mocked(statSync).mockReset();
    vi.mocked(chmodSync).mockReset();
  });

  it('chmods to mode | 0o755 when no exec bit is set', () => {
    vi.mocked(statSync).mockReturnValue({ mode: 0o644 } as never);
    ensureExecutable('/some/bin');
    expect(chmodSync).toHaveBeenCalledWith('/some/bin', 0o644 | 0o755);
  });

  it('skips chmod when any exec bit is already set', () => {
    vi.mocked(statSync).mockReturnValue({ mode: 0o755 } as never);
    ensureExecutable('/some/bin');
    expect(chmodSync).not.toHaveBeenCalled();
  });

  it('swallows stat errors (spawn surfaces the real one)', () => {
    vi.mocked(statSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(() => ensureExecutable('/missing')).not.toThrow();
    expect(chmodSync).not.toHaveBeenCalled();
  });
});
