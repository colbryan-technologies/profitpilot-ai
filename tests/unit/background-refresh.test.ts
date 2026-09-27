import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { startBackgroundRefresh } from "../../app/lib/background-refresh";

class Visibility extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
  set(value: DocumentVisibilityState) {
    this.visibilityState = value;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("refreshes until stopped and does not schedule work after cleanup", async () => {
  const refresh = vi.fn().mockResolvedValue(undefined);
  const stop = startBackgroundRefresh(refresh, new Visibility());
  await vi.advanceTimersByTimeAsync(10000);
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(20000);
  expect(refresh).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("pauses in a hidden tab and checks immediately when it becomes visible", async () => {
  const visibility = new Visibility();
  const refresh = vi.fn().mockResolvedValue(undefined);
  const stop = startBackgroundRefresh(refresh, visibility);
  visibility.set("hidden");
  await vi.advanceTimersByTimeAsync(20000);
  expect(refresh).not.toHaveBeenCalled();
  visibility.set("visible");
  await vi.advanceTimersByTimeAsync(0);
  expect(refresh).toHaveBeenCalledTimes(1);
  stop();
  visibility.set("visible");
  await vi.advanceTimersByTimeAsync(10000);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("never overlaps slow refreshes, including visibility changes", async () => {
  let finish!: () => void;
  const refresh = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const visibility = new Visibility();
  const stop = startBackgroundRefresh(refresh, visibility);
  await vi.advanceTimersByTimeAsync(5000);
  visibility.set("hidden");
  visibility.set("visible");
  await vi.advanceTimersByTimeAsync(30000);
  expect(refresh).toHaveBeenCalledTimes(1);
  stop();
  finish();
  await vi.advanceTimersByTimeAsync(10000);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("backs off after a failed refresh", async () => {
  const refresh = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const stop = startBackgroundRefresh(refresh, new Visibility());
  await vi.advanceTimersByTimeAsync(5000);
  await vi.advanceTimersByTimeAsync(14999);
  expect(refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(refresh).toHaveBeenCalledTimes(2);
  stop();
});
