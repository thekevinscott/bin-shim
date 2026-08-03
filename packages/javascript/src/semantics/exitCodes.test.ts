import { describe, it, expect, vi } from 'vitest';
import {
  applyExitSemantics,
  SIGINT_EXIT_CODE,
  SIGTERM_EXIT_CODE,
} from './exitCodes.js';
import type { SignalRaiser } from '../types.js';

/** A raiser that records instead of dying, so tests survive it. */
const recordingRaiser = () => {
  const raised: string[] = [];
  const raiseSignal = vi.fn(((signal) => {
    raised.push(signal);
    throw new Error(`raised:${signal}`);
  }) as SignalRaiser);
  return { raised, raiseSignal };
};

describe('applyExitSemantics', () => {
  describe('on POSIX', () => {
    it.each([0, 1, 101, 255])('passes code %i through', (code) => {
      const { raiseSignal } = recordingRaiser();
      expect(applyExitSemantics(code, { platform: 'linux', raiseSignal })).toBe(
        code,
      );
      expect(raiseSignal).not.toHaveBeenCalled();
    });

    it('re-raises SIGINT for 130', () => {
      const { raised, raiseSignal } = recordingRaiser();
      expect(() =>
        applyExitSemantics(SIGINT_EXIT_CODE, { platform: 'linux', raiseSignal }),
      ).toThrow('raised:SIGINT');
      expect(raised).toEqual(['SIGINT']);
    });

    it('re-raises SIGTERM for 143', () => {
      const { raised, raiseSignal } = recordingRaiser();
      expect(() =>
        applyExitSemantics(SIGTERM_EXIT_CODE, {
          platform: 'linux',
          raiseSignal,
        }),
      ).toThrow('raised:SIGTERM');
      expect(raised).toEqual(['SIGTERM']);
    });
  });

  describe('on Windows', () => {
    it.each([0, 1, SIGINT_EXIT_CODE, SIGTERM_EXIT_CODE, 255])(
      'passes code %i through without re-raising',
      (code) => {
        const { raiseSignal } = recordingRaiser();
        expect(
          applyExitSemantics(code, { platform: 'win32', raiseSignal }),
        ).toBe(code);
        expect(raiseSignal).not.toHaveBeenCalled();
      },
    );
  });

  it('defaults platform to the host and needs no options object', () => {
    // 7 is not a shutdown code, so this is platform-independent — it pins
    // the `opts = {}` and `platform = process.platform` defaults.
    expect(applyExitSemantics(7)).toBe(7);
  });

  it('uses defaultSignalRaiser when none is injected', () => {
    // Proven without dying by targeting Windows, where the raiser is never
    // reached; the raiser's own behavior is covered in signalRaiser.test.ts
    // and end-to-end in conformance.test.ts.
    expect(applyExitSemantics(SIGINT_EXIT_CODE, { platform: 'win32' })).toBe(
      SIGINT_EXIT_CODE,
    );
  });

  it('exposes the 128 + N constants', () => {
    expect(SIGINT_EXIT_CODE).toBe(130);
    expect(SIGTERM_EXIT_CODE).toBe(143);
  });
});
