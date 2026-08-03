import { describe, it, expect, vi } from 'vitest';
import { resolveRunCli } from './addon.js';

const baseOpts = {
  scope: 'foo',
  binaryName: 'foo',
  from: import.meta.url,
  platform: 'linux' as NodeJS.Platform,
  arch: 'x64' as NodeJS.Architecture,
};

describe('resolveRunCli', () => {
  it('loads the napi-shaped addon package and returns its runCli', () => {
    const runCli = vi.fn(() => 0);
    const load = vi.fn(() => ({ runCli }));
    expect(resolveRunCli({ ...baseOpts, load })).toBe(runCli);
    expect(load).toHaveBeenCalledWith('@foo/lib-linux-x64');
  });

  it('honours a custom entryPoint', () => {
    const other = vi.fn(() => 0);
    const load = vi.fn(() => ({ other }));
    expect(
      resolveRunCli({ ...baseOpts, entryPoint: 'other', load }),
    ).toBe(other);
  });

  it('honours platformPackage overrides', () => {
    const runCli = vi.fn(() => 0);
    const load = vi.fn(() => ({ runCli }));
    resolveRunCli({
      ...baseOpts,
      platformPackage: '@{scope}/{triple}',
      triples: { 'linux-x64': 'x86_64-unknown-linux-gnu' },
      load,
    });
    expect(load).toHaveBeenCalledWith('@foo/x86_64-unknown-linux-gnu');
  });

  it('wraps a load failure with an install hint and preserves the cause', () => {
    const cause = new Error('Cannot find module');
    const load = vi.fn(() => {
      throw cause;
    });
    let thrown: unknown;
    try {
      resolveRunCli({ ...baseOpts, load });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(
      /no prebuilt addon for linux-x64.*@foo\/lib-linux-x64.*npm install foo/s,
    );
    expect((thrown as Error).cause).toBe(cause);
  });

  it('rejects an addon with no such export', () => {
    const load = vi.fn(() => ({}));
    expect(() => resolveRunCli({ ...baseOpts, load })).toThrow(
      /no callable 'runCli' export \(got undefined\)/,
    );
  });

  it('rejects a non-callable export', () => {
    const load = vi.fn(() => ({ runCli: 42 }));
    expect(() => resolveRunCli({ ...baseOpts, load })).toThrow(
      /no callable 'runCli' export \(got number\)/,
    );
  });

  it('rejects a null module without throwing on property access', () => {
    const load = vi.fn(() => null);
    expect(() => resolveRunCli({ ...baseOpts, load })).toThrow(
      /no callable 'runCli' export \(got undefined\)/,
    );
  });

  it('defaults platform and arch to the host', () => {
    const runCli = vi.fn(() => 0);
    const load = vi.fn(() => ({ runCli }));
    resolveRunCli({
      scope: 'foo',
      binaryName: 'foo',
      from: import.meta.url,
      load,
    });
    expect(load).toHaveBeenCalledWith(
      `@foo/lib-${process.platform}-${process.arch}`,
    );
  });

  it('defaults the loader to createRequire(from) when none is supplied', () => {
    // No addon is installed, so the default loader must fail with the
    // documented message rather than, say, a TypeError from a missing seam.
    expect(() =>
      resolveRunCli({
        scope: 'definitely-not-installed-xyz',
        binaryName: 'definitely-not-installed-xyz',
        from: import.meta.url,
      }),
    ).toThrow(/no prebuilt addon/);
  });
});
