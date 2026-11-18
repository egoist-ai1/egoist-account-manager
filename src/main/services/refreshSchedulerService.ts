export const RefreshPriority = { fleet: 10, active: 50, manual: 100 } as const;

interface RefreshJob {
  key: string;
  generation: string;
  priority: number;
  sequence: number;
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<unknown>;
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  started: boolean;
}

export interface RefreshScheduleOptions {
  priority?: number;
  generation?: string;
}

/** Deduplicates probes; credential writes remain owned by the account coordinator. */
export class RefreshSchedulerService {
  private readonly jobs = new Map<string, RefreshJob>();
  private readonly queue: RefreshJob[] = [];
  private readonly idleWaiters = new Set<() => void>();
  private active = 0;
  private sequence = 0;
  private pauses = 0;
  private disposed = false;
  private scheduled = false;

  constructor(private readonly concurrency = 2) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) throw new Error("Quota probe concurrency must be one or two");
  }

  schedule<T>(key: string, run: (signal: AbortSignal) => Promise<T>, options: RefreshScheduleOptions = {}): Promise<T> {
    if (this.disposed) return Promise.reject(new Error("Refresh scheduler is disposed"));
    if (!key) return Promise.reject(new Error("Refresh key is required"));
    const generation = options.generation ?? "";
    const existing = this.jobs.get(key);
    if (existing && existing.generation === generation && !existing.controller.signal.aborted) {
      existing.priority = Math.max(existing.priority, options.priority ?? RefreshPriority.fleet);
      return existing.promise as Promise<T>;
    }
    if (existing) this.cancel(key, "Refresh generation changed");
    let resolve!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((accept, fail) => { resolve = accept; reject = fail; });
    const job: RefreshJob = { key, generation, priority: options.priority ?? RefreshPriority.fleet, sequence: this.sequence++,
      controller: new AbortController(), run, promise, resolve, reject, started: false };
    this.jobs.set(key, job);
    this.queue.push(job);
    this.requestDispatch();
    return promise as Promise<T>;
  }

  cancel(key: string, message = "Refresh cancelled"): boolean {
    const job = this.jobs.get(key);
    if (!job) return false;
    const error = new Error(message);
    error.name = "AbortError";
    job.controller.abort(error);
    job.reject(error);
    this.jobs.delete(key);
    if (!job.started) {
      const index = this.queue.indexOf(job);
      if (index >= 0) this.queue.splice(index, 1);
    }
    this.notifyIdle();
    return true;
  }

  cancelAll(message = "Refresh cancelled"): void {
    for (const key of [...this.jobs.keys()]) this.cancel(key, message);
  }

  pause(): () => void {
    this.pauses += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pauses -= 1;
      this.requestDispatch();
    };
  }

  whenIdle(): Promise<void> {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  getStats(): { active: number; queued: number; paused: boolean } {
    return { active: this.active, queued: this.queue.length, paused: this.pauses > 0 };
  }

  dispose(): void {
    this.disposed = true;
    this.cancelAll("Refresh scheduler disposed");
  }

  private requestDispatch(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.disposed || this.pauses > 0) return;
      this.queue.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
      while (this.active < this.concurrency && this.queue.length > 0) {
        const job = this.queue.shift()!;
        job.started = true;
        this.active += 1;
        Promise.resolve().then(() => job.run(job.controller.signal)).then(
          (result) => { if (!job.controller.signal.aborted) job.resolve(result); },
          (error) => { if (!job.controller.signal.aborted) job.reject(error); }
        ).finally(() => {
          this.active -= 1;
          if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
          this.notifyIdle();
          this.requestDispatch();
        });
      }
    });
  }

  private notifyIdle(): void {
    if (this.active !== 0 || this.queue.length !== 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
