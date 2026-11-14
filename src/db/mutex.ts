/**
 * One-at-a-time access to the database connection. expo-sqlite shares one
 * connection, and its transactions are not exclusive: without this, a write
 * fired from elsewhere (a settings save, an embedding, a refresh) could run
 * inside another action's transaction, be rolled back with it, or fail with
 * "cannot start a transaction within a transaction".
 */
export function createMutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task, task);
      // Keep the chain going whether this task succeeds or fails.
      tail = result.catch(() => {});
      return result;
    },
  };
}

export type Mutex = ReturnType<typeof createMutex>;

/** Wraps every function of `api` so each call holds the mutex for its whole duration. */
export function serializeAll<A extends Record<string, (...args: never[]) => Promise<unknown>>>(api: A, mutex: Mutex): A {
  const out: Record<string, unknown> = {};
  for (const [key, fn] of Object.entries(api)) {
    out[key] = (...args: never[]) => mutex.run(() => fn(...args));
  }
  return out as A;
}
