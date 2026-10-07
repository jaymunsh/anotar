export const textSyncDelay = 1000;
export const textSyncMaxWait = 5000;

type Timer = ReturnType<typeof setTimeout>;
export function createDebouncedSync(
  run: () => void | Promise<void>,
  options: {
    clock?: () => number;
    setTimer?: (callback: () => void, delay: number) => Timer;
    clearTimer?: (timer: Timer) => void;
    onError?: (error: unknown) => void;
  } = {},
) {
  const clock = options.clock ?? Date.now;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let first: number | undefined;
  let timer: Timer | undefined;
  const cancel = () => {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
    first = undefined;
  };
  const flush = async () => {
    cancel();
    await run();
  };
  return {
    schedule() {
      const now = clock();
      first ??= now;
      const due = Math.min(now + textSyncDelay, first + textSyncMaxWait);
      if (timer !== undefined) clearTimer(timer);
      timer = setTimer(
        () => {
          void flush().catch((error) => options.onError?.(error));
        },
        Math.max(0, due - now),
      );
      return due;
    },
    flush,
    cancel,
  };
}
