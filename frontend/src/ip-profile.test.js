import { describe, it, expect } from "vitest";
import { exitGroups } from "./ip-profile.js";

describe("dual-stack observations", () => {
  it("keeps IPv4 and IPv6 geography separate", () => {
    const groups = exitGroups({ addresses: { ipv4: "45.221.115.219", ipv6: "2401:1fe0:2::59a" }, observations: [
      { ip: "45.221.115.219", countryCode: "TW", city: "Taipei" },
      ...["IPWho", "Cloudflare", "IPPure"].map(source => ({ source, ip: "2401:1fe0:2::59a", countryCode: "HK" })),
    ] });
    expect(groups[0].countries).toEqual(["TW"]);
    expect(groups[1].countries).toEqual(["HK"]);
    expect(groups.every(group => !group.conflict)).toBe(true);
  });
  it("flags only conflicting countries on the same address", () => {
    const [group] = exitGroups({ addresses: { ipv4: "203.0.113.1" }, observations: [
      { ip: "203.0.113.1", countryCode: "US" }, { ip: "203.0.113.1", countryCode: "JP" },
    ] });
    expect(group.conflict).toBe(true);
    expect(exitGroups(null)[1].address).toBe("");
  });
});
