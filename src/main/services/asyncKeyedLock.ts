export class AsyncKeyedLock {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(keys: string | string[], operation: () => Promise<T>): Promise<T> {
    const orderedKeys = [...new Set(Array.isArray(keys) ? keys : [keys])].sort();
    const runAt = async (index: number): Promise<T> => {
      const key = orderedKeys[index];
      if (key === undefined) return operation();
      return this.runSingle(key, () => runAt(index + 1));
    };
    return runAt(0);
  }

  isLocked(key: string): boolean {
    return this.tails.has(key);
  }

  private async runSingle<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.tails.set(key, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
