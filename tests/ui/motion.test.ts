import { describe, expect, it, vi } from "vitest";
import { motionAllowed, SurfaceMotion } from "../../src/renderer/motion";

describe("surface motion lifecycle", () => {
  it("never starts work for hidden surfaces or reduced motion", () => {
    const create = vi.fn();
    const owner = new SurfaceMotion();
    owner.replace(create, motionAllowed("hidden", false));
    owner.replace(create, motionAllowed("visible", true));
    expect(create).not.toHaveBeenCalled();
  });

  it("cancels the previous action and keeps a late completion from disposing the new action", async () => {
    let finishFirst: () => void = () => undefined;
    const first = { cancel: vi.fn(), finished: new Promise<void>((resolve) => { finishFirst = resolve; }) };
    const second = { cancel: vi.fn(), finished: new Promise<void>(() => undefined) };
    const owner = new SurfaceMotion();
    owner.replace(() => first, true);
    owner.replace(() => second, true);
    expect(first.cancel).toHaveBeenCalledOnce();
    finishFirst();
    await Promise.resolve();
    await Promise.resolve();
    owner.cancel();
    expect(second.cancel).toHaveBeenCalledOnce();
  });

  it("cancellation when motion becomes unavailable settles the current action", () => {
    const animation = { cancel: vi.fn(), finished: new Promise<void>(() => undefined) };
    const owner = new SurfaceMotion();
    owner.replace(() => animation, true);
    owner.replace(() => animation, false);
    expect(animation.cancel).toHaveBeenCalledOnce();
    owner.cancel();
    expect(animation.cancel).toHaveBeenCalledOnce();
  });
});
