import * as _binary from '../resolve/binary.js';
import { resolveBinary } from '../resolve/binary.js';
import * as _defaults from '../defaults/index.js';
import { defaultSpawner } from '../defaults/index.js';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { main } from './main.js';

vi.mock('../resolve/binary.js', async () => {
  const actual = (await vi.importActual(
    '../resolve/binary.js',
  )) as typeof _binary;
  return {
    ...actual,
    resolveBinary: vi.fn(),
  };
});

vi.mock('../defaults/index.js', async () => {
  const actual = (await vi.importActual('../defaults/index.js')) as typeof _defaults;
  return {
    ...actual,
    defaultSpawner: vi.fn(),
  };
});

const baseOpts = {
  scope: 'foo',
  binaryName: 'foo',
  from: import.meta.url,
};

describe('main', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('spawns the resolved binary with argv and propagates exit code', async () => {
    const resolveBin = vi.fn(() => '/bin/foo');
    const spawn = vi.fn(async () => 0);
    const code = await main({
      ...baseOpts,
      argv: ['--help'],
      resolveBin,
      spawn,
    });
    expect(spawn).toHaveBeenCalledWith('/bin/foo', ['--help']);
    expect(code).toBe(0);
  });

  it('rejects when resolveBin throws', async () => {
    const resolveBin = vi.fn(() => {
      throw new Error('boom');
    });
    const spawn = vi.fn();
    await expect(
      main({ ...baseOpts, argv: [], resolveBin, spawn }),
    ).rejects.toThrow('boom');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('rejects when spawn rejects', async () => {
    const resolveBin = vi.fn(() => '/bin/foo');
    const spawn = vi.fn(async () => {
      throw new Error('ENOENT');
    });
    await expect(
      main({ ...baseOpts, argv: [], resolveBin, spawn }),
    ).rejects.toThrow('ENOENT');
  });

  it('propagates non-zero exit codes', async () => {
    const resolveBin = vi.fn(() => '/bin/foo');
    const spawn = vi.fn(async () => 2);
    expect(
      await main({
        ...baseOpts,
        argv: ['bad-arg'],
        resolveBin,
        spawn,
      }),
    ).toBe(2);
  });

  it('uses default resolveBin when none supplied', async () => {
    vi.mocked(resolveBinary).mockImplementation(() => '/bin/foo');
    const spawn = vi.fn(async () => 0);
    const code = await main({ ...baseOpts, argv: [], spawn });
    expect(resolveBinary).toHaveBeenCalledWith(
      expect.objectContaining(baseOpts),
    );
    expect(spawn).toHaveBeenCalledWith('/bin/foo', []);
    expect(code).toBe(0);
  });

  it('uses default argv (process.argv.slice(2)) when none supplied', async () => {
    const resolveBin = vi.fn(() => '/bin/foo');
    const spawn = vi.fn(async () => 0);
    expect(await main({ ...baseOpts, resolveBin, spawn })).toBe(0);
    expect(spawn).toHaveBeenCalledWith('/bin/foo', process.argv.slice(2));
  });

  it('uses default spawn when none supplied', async () => {
    vi.mocked(defaultSpawner).mockImplementation(async () => 0);
    const resolveBin = vi.fn(() => '/bin/foo');
    const code = await main({
      ...baseOpts,
      argv: ['hello'],
      resolveBin,
    });
    expect(defaultSpawner).toHaveBeenCalledWith('/bin/foo', ['hello']);
    expect(code).toBe(0);
  });
});
