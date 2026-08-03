import { describe, it, expect, vi } from 'vitest';
import { flushStdio } from './flush.js';

const stream = (writableLength: number) => ({
  writableLength,
  write: vi.fn((_chunk: string, cb: () => void) => {
    cb();
    return true;
  }),
});

describe('flushStdio', () => {
  it('drains every stream that has buffered bytes', async () => {
    const out = stream(12);
    const err = stream(3);
    await flushStdio([out, err]);
    expect(out.write).toHaveBeenCalledWith('', expect.any(Function));
    expect(err.write).toHaveBeenCalledWith('', expect.any(Function));
  });

  it('skips the write when a stream has nothing buffered', async () => {
    const out = stream(0);
    await flushStdio([out]);
    expect(out.write).not.toHaveBeenCalled();
  });

  it('waits for the drain callback before resolving', async () => {
    let release: (() => void) | undefined;
    const out = {
      writableLength: 5,
      write: vi.fn((_chunk: string, cb: () => void) => {
        release = cb;
        return false;
      }),
    };
    let settled = false;
    const pending = flushStdio([out]).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release!();
    await pending;
    expect(settled).toBe(true);
  });

  it('defaults to the process stdio streams', async () => {
    // process.stdout/stderr are idle under the test runner, so this takes
    // the zero-length path and simply must not hang or throw.
    await expect(flushStdio()).resolves.toBeUndefined();
  });
});
