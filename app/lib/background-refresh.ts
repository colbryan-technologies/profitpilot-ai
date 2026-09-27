/** Poll only while mounted and visible; never overlap requests. */
export function startBackgroundRefresh(
  refresh: () => Promise<void>,
  visibility: Pick<
    Document,
    "visibilityState" | "addEventListener" | "removeEventListener"
  >,
) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!stopped && visibility.visibilityState !== "hidden")
      timer = setTimeout(tick, delay);
  };
  const tick = async () => {
    if (stopped || running || visibility.visibilityState === "hidden") return;
    running = true;
    let delay = 5000;
    try {
      await refresh();
    } catch {
      delay = 15000;
    } finally {
      running = false;
      schedule(delay);
    }
  };
  const changed = () => {
    clearTimeout(timer);
    if (!running) schedule(0);
  };
  visibility.addEventListener("visibilitychange", changed);
  schedule(5000);
  return () => {
    stopped = true;
    clearTimeout(timer);
    visibility.removeEventListener("visibilitychange", changed);
  };
}
