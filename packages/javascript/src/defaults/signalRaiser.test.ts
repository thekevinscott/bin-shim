import { afterEach, describe, it, expect, vi } from 'vitest';
import { defaultSignalRaiser } from './signalRaiser.js';

describe('defaultSignalRaiser', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops listeners then re-raises the signal at this process', () => {
    const removeAllListeners = vi
      .spyOn(process, 'removeAllListeners')
      .mockReturnValue(process);
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);

    // Real delivery kills the process inside kill(); with kill stubbed we
    // fall through to the guard, which is how the test survives.
    expect(() => defaultSignalRaiser('SIGINT')).toThrow(
      /re-raised SIGINT but the process is still running/,
    );
    expect(removeAllListeners).toHaveBeenCalledWith('SIGINT');
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGINT');
    expect(removeAllListeners.mock.invocationCallOrder[0]!).toBeLessThan(
      kill.mock.invocationCallOrder[0]!,
    );
  });

  it('works for SIGTERM too', () => {
    vi.spyOn(process, 'removeAllListeners').mockReturnValue(process);
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true);
    expect(() => defaultSignalRaiser('SIGTERM')).toThrow(
      /re-raised SIGTERM/,
    );
    expect(kill).toHaveBeenCalledWith(process.pid, 'SIGTERM');
  });
});
