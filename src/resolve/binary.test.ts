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

  describe('platformPackage template', () => {
    it('substitutes {scope}, {platform}, {arch}', () => {
      const resolver = vi.fn((id: string) => id);
      resolveBinary({
        scope: 'foo',
        binaryName: 'foo',
        from: import.meta.url,
        platform: 'linux',
        arch: 'x64',
        platformPackage: '@{scope}/cli-{platform}-{arch}',
        resolver,
      });
      expect(resolver).toHaveBeenCalledWith('@foo/cli-linux-x64/bin/foo');
    });

    it('substitutes {triple} from the triples map', () => {
      const resolver = vi.fn((id: string) => id);
      resolveBinary({
        scope: 'dark-factory',
        binaryName: 'darkfactory',
        from: import.meta.url,
        platform: 'linux',
        arch: 'x64',
        platformPackage: '@{scope}/{triple}',
        triples: { 'linux-x64': 'x86_64-unknown-linux-gnu' },
        resolver,
      });
      expect(resolver).toHaveBeenCalledWith(
        '@dark-factory/x86_64-unknown-linux-gnu/bin/darkfactory',
      );
    });

    it('throws when {triple} is referenced without a matching triples entry', () => {
      const resolver = vi.fn((id: string) => id);
      expect(() =>
        resolveBinary({
          scope: 'foo',
          binaryName: 'foo',
          from: import.meta.url,
          platform: 'linux',
          arch: 'arm64',
          platformPackage: '@{scope}/{triple}',
          triples: { 'linux-x64': 'x86_64-unknown-linux-gnu' },
          resolver,
        }),
      ).toThrow(/no triple mapping was provided for linux-arm64/);
    });

    it('throws when {triple} is referenced without a triples map at all', () => {
      const resolver = vi.fn((id: string) => id);
      expect(() =>
        resolveBinary({
          scope: 'foo',
          binaryName: 'foo',
          from: import.meta.url,
          platform: 'linux',
          arch: 'x64',
          platformPackage: '@{scope}/{triple}',
          resolver,
        }),
      ).toThrow(/no triple mapping was provided for linux-x64/);
    });

    it('throws when {scope} is referenced without a scope', () => {
      const resolver = vi.fn((id: string) => id);
      expect(() =>
        resolveBinary({
          binaryName: 'foo',
          from: import.meta.url,
          platform: 'linux',
          arch: 'x64',
          platformPackage: '@{scope}/{platform}-{arch}',
          resolver,
        }),
      ).toThrow(/uses \{scope\} but no scope was provided/);
    });

    it('supports unscoped templates', () => {
      const resolver = vi.fn((id: string) => id);
      resolveBinary({
        binaryName: 'foo',
        from: import.meta.url,
        platform: 'linux',
        arch: 'x64',
        platformPackage: 'foo-{platform}-{arch}',
        resolver,
      });
      expect(resolver).toHaveBeenCalledWith('foo-linux-x64/bin/foo');
    });
  });

  describe('packageName function', () => {
    it('uses the function when provided', () => {
      const resolver = vi.fn((id: string) => id);
      const packageName = vi.fn(
        ({ platform, arch }) => `@dark-factory/cli-${platform}-${arch}`,
      );
      resolveBinary({
        scope: 'dark-factory',
        binaryName: 'darkfactory',
        from: import.meta.url,
        platform: 'linux',
        arch: 'x64',
        packageName,
        resolver,
      });
      expect(packageName).toHaveBeenCalledWith({
        platform: 'linux',
        arch: 'x64',
        scope: 'dark-factory',
        binaryName: 'darkfactory',
      });
      expect(resolver).toHaveBeenCalledWith(
        '@dark-factory/cli-linux-x64/bin/darkfactory',
      );
    });

    it('takes precedence over platformPackage when both are set', () => {
      const resolver = vi.fn((id: string) => id);
      const packageName = vi.fn(() => '@from/fn');
      resolveBinary({
        scope: 'foo',
        binaryName: 'foo',
        from: import.meta.url,
        platform: 'linux',
        arch: 'x64',
        platformPackage: '@{scope}/from-template',
        packageName,
        resolver,
      });
      expect(resolver).toHaveBeenCalledWith('@from/fn/bin/foo');
    });
  });
});
