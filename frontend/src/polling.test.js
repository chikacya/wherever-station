import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVisiblePoller } from "./polling.js";
import { createReadCoalescer } from "./read-coalescer.js";

let documentStub;
beforeEach(() => {
  vi.useFakeTimers();
  documentStub = new EventTarget();
  documentStub.hidden = false;
  vi.stubGlobal("document", documentStub);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const flush = () => vi.advanceTimersByTimeAsync(0);
const visibility = hidden => {
  documentStub.hidden = hidden;
  documentStub.dispatchEvent(new Event("visibilitychange"));
};

describe("visible polling", () => {
  it("never overlaps a slow read and waits one interval after completion", async () => {
    let resolve;
    const task = vi.fn(() => new Promise(done => { resolve = done; }));
    const stop = createVisiblePoller(task, { interval: 1000 });
    await flush();
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(1);
    resolve(); await flush();
    await vi.advanceTimersByTimeAsync(999);
    expect(task).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(2);
    stop(); resolve(); await flush();
  });
  it("pauses hidden pages, refreshes on return and stops on unmount", async () => {
    const task = vi.fn(async () => {});
    const stop = createVisiblePoller(task, { interval: 1000 });
    await flush(); visibility(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(task).toHaveBeenCalledTimes(1);
    visibility(false); await flush();
    expect(task).toHaveBeenCalledTimes(2);
    stop(); visibility(true); visibility(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(task).toHaveBeenCalledTimes(2);
  });
  it("cannot restart from a late response after its page unmounts", async () => {
    let resolve;
    const task = vi.fn(() => new Promise(done => { resolve = done; }));
    const stop = createVisiblePoller(task, { interval: 1000 });
    await flush(); stop(); resolve(); await flush();
    await vi.advanceTimersByTimeAsync(10000);
    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe("simultaneous passive reads", () => {
  it("shares a pending read without caching subsequent reads", async () => {
    let resolve;
    const request = vi.fn(() => new Promise(done => { resolve = done; }));
    const rpc = createReadCoalescer(request);
    const first = rpc("common:getNodesLatestStatus");
    const second = rpc("common:getNodesLatestStatus");
    expect(second).toBe(first);
    await flush(); expect(request).toHaveBeenCalledTimes(1);
    resolve({ online: true }); await expect(first).resolves.toEqual({ online: true });
    const third = rpc("common:getNodesLatestStatus");
    await flush(); expect(request).toHaveBeenCalledTimes(2);
    resolve({ online: false }); await expect(third).resolves.toEqual({ online: false });
  });
  it("does not combine commands, writes or reads with different parameters", async () => {
    const request = vi.fn(async () => ({}));
    const rpc = createReadCoalescer(request);
    await Promise.all([
      rpc("admin:exec", { command: "true" }), rpc("admin:exec", { command: "true" }),
      rpc("proxyConsole:saveState"), rpc("proxyConsole:saveState"),
      rpc("common:getNodes", { id: "a" }), rpc("common:getNodes", { id: "b" }),
    ]);
    expect(request).toHaveBeenCalledTimes(6);
  });
  it("releases failed reads so the next request can retry", async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("fresh");
    const rpc = createReadCoalescer(request);
    await expect(rpc("common:getNodes")).rejects.toThrow("offline");
    await expect(rpc("common:getNodes")).resolves.toBe("fresh");
  });
});
