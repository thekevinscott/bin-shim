import { describe, it, expect, vi } from 'vitest';
import { buildPackageName } from './packageName.js';

const DEFAULT = '@{scope}/{platform}-{arch}';

describe('buildPackageName', () => {
  it('expands the default template', () => {
    expect(
      buildPackageName(
        { scope: 'foo', binaryName: 'foo' },
        'linux',
        'x64',
        DEFAULT,
      ),
    ).toBe('@foo/linux-x64');
  });

  it('honours a caller-supplied default template', () => {
    expect(
      buildPackageName(
        { scope: 'foo', binaryName: 'foo' },
        'darwin',
        'arm64',
        '@{scope}/lib-{platform}-{arch}',
      ),
    ).toBe('@foo/lib-darwin-arm64');
  });

  it('prefers platformPackage over the default template', () => {
    expect(
      buildPackageName(
        { scope: 'foo', binaryName: 'foo', platformPackage: '{scope}-{arch}' },
        'linux',
        'arm64',
        DEFAULT,
      ),
    ).toBe('foo-arm64');
  });

  it('expands {triple} from the triples map', () => {
    expect(
      buildPackageName(
        {
          scope: 'foo',
          binaryName: 'foo',
          platformPackage: '@{scope}/{triple}',
          triples: { 'linux-x64': 'x86_64-unknown-linux-gnu' },
        },
        'linux',
        'x64',
        DEFAULT,
      ),
    ).toBe('@foo/x86_64-unknown-linux-gnu');
  });

  it('throws when {triple} has no mapping for the host pair', () => {
    expect(() =>
      buildPackageName(
        {
          scope: 'foo',
          binaryName: 'foo',
          platformPackage: '@{scope}/{triple}',
          triples: { 'linux-x64': 'x86_64-unknown-linux-gnu' },
        },
        'darwin',
        'arm64',
        DEFAULT,
      ),
    ).toThrow(/no triple mapping was provided for darwin-arm64/);
  });

  it('throws when {triple} is used with no triples map at all', () => {
    expect(() =>
      buildPackageName(
        { scope: 'foo', binaryName: 'foo', platformPackage: '@{scope}/{triple}' },
        'linux',
        'x64',
        DEFAULT,
      ),
    ).toThrow(/no triple mapping/);
  });

  it('throws when {scope} is used but no scope was provided', () => {
    expect(() =>
      buildPackageName({ binaryName: 'foo' }, 'linux', 'x64', DEFAULT),
    ).toThrow(/uses \{scope\} but no scope was provided/);
  });

  it('allows a scope-free template when no scope is provided', () => {
    expect(
      buildPackageName(
        { binaryName: 'foo', platformPackage: 'foo-{platform}-{arch}' },
        'linux',
        'x64',
        DEFAULT,
      ),
    ).toBe('foo-linux-x64');
  });

  it('delegates to packageName, which wins over platformPackage', () => {
    const packageName = vi.fn(() => 'custom-pkg');
    expect(
      buildPackageName(
        {
          scope: 'foo',
          binaryName: 'bar',
          platformPackage: 'ignored-{platform}',
          packageName,
        },
        'win32',
        'x64',
        DEFAULT,
      ),
    ).toBe('custom-pkg');
    expect(packageName).toHaveBeenCalledWith({
      platform: 'win32',
      arch: 'x64',
      scope: 'foo',
      binaryName: 'bar',
    });
  });
});
