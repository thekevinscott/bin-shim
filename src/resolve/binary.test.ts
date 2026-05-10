import * as _defaults from '../defaults.js';
import { defaultResolver } from '../defaults.js';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { resolveBinary } from './binary.js';

vi.mock('../defaults.js', async () => {
  const actual = (await vi.importActual('../defaults.js')) as typeof _defaults;
  return {
    ...actual,
    defaultResolver: vi.fn(),
  };
});

describe('resolveBinary', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the per-platform optional dep on linux/x64', () => {
    const resolver = vi.fn((id: string) => id);
    const path = resolveBinary({
      scope: 'foo',
      binaryName: 'foo',
      from: import.meta.url,
      platform: 'linux',
      arch: 'x64',
      resolver,
    });
    expect(resolver).toHaveBeenCalledWith('@foo/linux-x64/bin/foo');
    expect(path).toBe('@foo/linux-x64/bin/foo');
  });

  it('appends .exe on win32', () => {
    const resolver = vi.fn((id: string) => id);
    resolveBinary({
      scope: 'foo',
      binaryName: 'foo',
      from: import.meta.url,
      platform: 'win32',
      arch: 'x64',
      resolver,
    });
    expect(resolver).toHaveBeenCalledWith('@foo/win32-x64/bin/foo.exe');
  });

  it('throws when the optional dep is not installed', () => {
    const resolver = vi.fn(() => {
      throw new Error('not found');
    });
    expect(() =>
      resolveBinary({
        scope: 'foo',
        binaryName: 'foo',
        from: import.meta.url,
        platform: 'linux',
        arch: 'arm64',
        resolver,
      }),
    ).toThrow(/no prebuilt binary for linux-arm64/);
  });

  it('preserves the original error as cause', () => {
    const cause = new Error('inner');
    try {
      resolveBinary({
        scope: 'foo',
        binaryName: 'foo',
        from: import.meta.url,
        platform: 'linux',
        arch: 'x64',
        resolver: () => {
          throw cause;
        },
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).cause).toBe(cause);
    }
  });

  it('uses default resolver when none supplied', () => {
    const fakeResolver = vi.fn((id: string) => id);
    vi.mocked(defaultResolver).mockReturnValue(fakeResolver);
    const path = resolveBinary({
      scope: 'foo',
      binaryName: 'foo',
      from: import.meta.url,
      platform: 'linux',
      arch: 'x64',
    });
    expect(defaultResolver).toHaveBeenCalledWith(import.meta.url);
    expect(fakeResolver).toHaveBeenCalledWith('@foo/linux-x64/bin/foo');
    expect(path).toBe('@foo/linux-x64/bin/foo');
  });

  it('uses process.platform/arch defaults when called without them', () => {
    vi.mocked(defaultResolver).mockReturnValue(
      vi.fn((id: string) => id),
    );
    const path = resolveBinary({
      scope: 'foo',
      binaryName: 'foo',
      from: import.meta.url,
    });
    expect(path).toContain(`@foo/${process.platform}-${process.arch}/bin/foo`);
  });
});
