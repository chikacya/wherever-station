// Poll only visible pages, and schedule the next sample after the current one settles.
export function createVisiblePoller(task, { interval, immediate = true, warmup = [] } = {}) {
  let stopped = false;
  let running = false;
  let timer;
  let resumePending = false;
  const visible = () => !document.hidden;
  const schedule = () => {
    clearTimeout(timer);
    if (!stopped && visible() && interval > 0) timer = setTimeout(run, interval);
  };
  const run = () => {
    if (stopped || !visible() || running) return;
    clearTimeout(timer);
    running = true;
    Promise.resolve().then(() => { if (!stopped && visible()) return task(); })
      .catch(() => { /* Each poll owns its error presentation. */ })
      .finally(() => {
        running = false;
        if (resumePending && !stopped && visible()) { resumePending = false; run(); }
        else schedule();
      });
  };
  const visibility = () => {
    clearTimeout(timer);
    if (!visible()) return;
    if (running) resumePending = true;
    else run();
  };
  document.addEventListener("visibilitychange", visibility);
  const warmupTimers = warmup.map(delay => setTimeout(run, delay));
  if (immediate) run(); else schedule();
  return () => {
    stopped = true;
    clearTimeout(timer);
    warmupTimers.forEach(clearTimeout);
    document.removeEventListener("visibilitychange", visibility);
  };
}
