import type { SignalRaiser } from '../types.js';

export const defaultSignalRaiser: SignalRaiser = (signal) => {
  // Drop any listeners so Node applies the signal's default disposition;
  // with a listener attached the process would merely handle the signal and
  // keep running, and the parent would never see WIFSIGNALED.
  process.removeAllListeners(signal);
  process.kill(process.pid, signal);
  // POSIX delivers the pending signal before kill() returns, so in
  // production this line is unreachable. It exists so the function is
  // statically `never`-returning even if kill is stubbed or the platform
  // refuses delivery.
  throw new Error(
    `bin-shim: re-raised ${signal} but the process is still running.`,
  );
};
