// Share only simultaneous passive reads; writes and task execution always remain separate.
const PASSIVE_READS = new Set([
  "common:getNodes", "common:getNodesLatestStatus", "public:getMe",
  "proxyConsole:getAccessStats", "proxyConsole:getSubscriptionTraffic",
  "proxyConsole:getCompatibilityCatalog", "proxyConsole:listInstanceStates",
  "proxyConsole:listManagedTasks",
]);
export function createReadCoalescer(request) {
  const pending = new Map();
  return (method, params = {}) => {
    if (!PASSIVE_READS.has(method)) return request(method, params);
    const key = JSON.stringify([method, params]);
    if (!pending.has(key)) {
      const value = Promise.resolve().then(() => request(method, params)).finally(() => pending.delete(key));
      pending.set(key, value);
    }
    return pending.get(key);
  };
}
