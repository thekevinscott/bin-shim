import * as _addon from '../resolve/addon.js';
import { resolveRunCli } from '../resolve/addon.js';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mainInProcess } from './mainInProcess.js';
import type { SignalRaiser } from '../types.js';

vi.mock('../resolve/addon.js', async () => {
  const actual = (await vi.importActual('../resolve/addon.js')) as typeof _addon;
  return { ...actual, resolveRunCli: vi.fn() };
});

const baseOpts = {
  scope: 'foo',
  binaryName: 'foo',
  from: import.meta.url,
  // Windows semantics keep every code a plain return, so no test dies.
  platform: 'win32' as NodeJS.Platform,
};

describe('mainInProcess', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls runCli with argv and returns its exit code', async () => {
    const runCli = vi.fn(() => 0);
    expect(
      await mainInProcess({ ...baseOpts, argv: ['--help'], runCli }),
    ).toBe(0);
    expect(runCli).toHaveBeenCalledWith(['--help']);
  });

  it('propagates non-zero exit codes', async () => {
    const runCli = vi.fn(() => 42);
    expect(await mainInProcess({ ...baseOpts, argv: [], runCli })).toBe(42);
  });

  it('defaults argv to process.argv.slice(2)', async () => {
    const runCli = vi.fn(() => 0);
    await mainInProcess({ ...baseOpts, runCli });
    expect(runCli).toHaveBeenCalledWith(process.argv.slice(2));
  });

  it('resolves runCli from the addon when none is injected', async () => {
    const runCli = vi.fn(() => 3);
    vi.mocked(resolveRunCli).mockReturnValue(runCli);
    expect(await mainInProcess({ ...baseOpts, argv: [] })).toBe(3);
    expect(resolveRunCli).toHaveBeenCalledWith(
      expect.objectContaining({ binaryName: 'foo' }),
    );
  });

  it('flushes host stdio before invoking runCli', async () => {
    const order: string[] = [];
    const flush = vi.fn(async () => {
      order.push('flush');
    });
    const runCli = vi.fn(() => {
      order.push('runCli');
      return 0;
    });
    await mainInProcess({ ...baseOpts, argv: [], runCli, flush });
    expect(order).toEqual(['flush', 'runCli']);
  });

  it('uses the real flush when none is injected', async () => {
    const runCli = vi.fn(() => 0);
    await expect(
      mainInProcess({ ...baseOpts, argv: [], runCli }),
    ).resolves.toBe(0);
  });

  it('applies exit semantics, re-raising on POSIX shutdown codes', async () => {
    const raised: string[] = [];
    const raiseSignal = vi.fn(((signal) => {
      raised.push(signal);
      throw new Error(`raised:${signal}`);
    }) as SignalRaiser);
    await expect(
      mainInProcess({
        ...baseOpts,
        platform: 'linux',
        argv: [],
        runCli: () => 130,
        raiseSignal,
      }),
    ).rejects.toThrow('raised:SIGINT');
    expect(raised).toEqual(['SIGINT']);
  });

  it('leaves 130 as a plain code on Windows', async () => {
    expect(
      await mainInProcess({ ...baseOpts, argv: [], runCli: () => 130 }),
    ).toBe(130);
  });

  it.each([
    ['undefined', undefined],
    ['a string', '0'],
    ['a non-integer', 1.5],
    ['NaN', Number.NaN],
  ])('rejects when runCli returns %s', async (_label, value) => {
    await expect(
      mainInProcess({
        ...baseOpts,
        argv: [],
        runCli: (() => value) as never,
      }),
    ).rejects.toThrow(/must return an integer exit code/);
  });

  it('names the configured entryPoint in the contract-violation error', async () => {
    await expect(
      mainInProcess({
        ...baseOpts,
        argv: [],
        entryPoint: 'other',
        runCli: (() => 'nope') as never,
      }),
    ).rejects.toThrow(/'other' must return an integer exit code; got string/);
  });

  it('propagates a resolution failure', async () => {
    vi.mocked(resolveRunCli).mockImplementation(() => {
      throw new Error('no prebuilt addon');
    });
    await expect(mainInProcess({ ...baseOpts, argv: [] })).rejects.toThrow(
      'no prebuilt addon',
    );
  });
});
