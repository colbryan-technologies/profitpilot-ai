import { createMemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { startBackgroundRefresh } from "../../app/lib/background-refresh";

afterEach(() => vi.useRealTimers());

it("refreshes current route figures after the background job completes without navigation", async () => {
  vi.useFakeTimers();
  let active = true;
  const parent = vi.fn(async () => ({ active }));
  const child = vi.fn(async () => ({ profit: active ? null : 252260 }));
  const router = createMemoryRouter(
    [
      {
        id: "app",
        path: "/app",
        loader: parent,
        children: [{ id: "overview", index: true, loader: child }],
      },
    ],
    {
      initialEntries: ["/app?period=30d"],
      hydrationData: {
        loaderData: { app: { active: true }, overview: { profit: null } },
      },
    },
  );
  const visibility = Object.assign(new EventTarget(), {
    visibilityState: "visible" as const,
  });
  const stop = startBackgroundRefresh(() => router.revalidate(), visibility);
  const unsubscribe = router.subscribe((state) => {
    if (state.revalidation === "idle" && state.loaderData.app?.active === false)
      stop();
  });
  try {
    await vi.advanceTimersByTimeAsync(5000);
    expect(router.state.loaderData.overview.profit).toBeNull();
    active = false;
    await vi.advanceTimersByTimeAsync(5000);
    expect(router.state.loaderData.overview.profit).toBe(252260);
    expect(router.state.location.pathname).toBe("/app");
    expect(router.state.location.search).toBe("?period=30d");
    expect(router.state.navigation.state).toBe("idle");
    const calls = child.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15000);
    expect(child).toHaveBeenCalledTimes(calls);
  } finally {
    stop();
    unsubscribe();
    router.dispose();
  }
});
