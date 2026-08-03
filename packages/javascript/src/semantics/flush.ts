interface FlushableStream {
  writableLength: number;
  write(chunk: string, callback: () => void): unknown;
}

const flushStream = (stream: FlushableStream): Promise<void> =>
  new Promise((resolve) => {
    // Nothing queued means nothing to drain. Skipping the write matters:
    // on a closed or destroyed stream the callback may never fire.
    if (stream.writableLength === 0) {
      resolve();
      return;
    }
    // An empty write whose callback runs once everything queued ahead of it
    // has been handed to the OS — Node exposes no synchronous flush.
    stream.write('', () => resolve());
  });

/**
 * Drain host stdio before handing control to the native side.
 *
 * The addon writes to file descriptors 1/2 directly, bypassing Node's stream
 * buffers. For a piped stdout on POSIX those buffers are asynchronous, so
 * without this any pending host output would surface *after* native output
 * (conformance row 6).
 */
export const flushStdio = async (
  streams: readonly FlushableStream[] = [process.stdout, process.stderr],
): Promise<void> => {
  await Promise.all(streams.map(flushStream));
};
