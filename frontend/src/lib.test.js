import { describe, expect, it } from "vitest";
import {
  androidAnywhereLink,
  buildRepairUri,
  generateRealityKeypair,
  flag,
  inferNodeCountryCode,
  localDateInput,
  moveItem,
  normalizeNodeName,
  normalizeNowhereReleases,
  normalizeSingBoxReleases,
  nowhereVersionCapabilities,
  preferredPublicHost,
  protocolLabel,
  splitTags,
  templateNodeNames,
  trafficPlanCycle,
  evaluateTrafficPlan,
} from "./lib.js";
import { buildPreflightReport } from "./preflight.js";

describe("ui helpers", () => {
  it("builds an allow-listed preflight report without URI or token fields", () => {
    const report = buildPreflightReport({ sub: { id: "sub-1", name: "测试" }, formats: [{ format: "mihomo", ok: true, included: 1, skipped: 2, bytes: 99, warnings: ["warn"], nodes: [{ id: "n1", name: "🇯🇵 节点", included: true, uri: "vless://secret" }] , token: "secret-token" }] });
    expect(report.formats[0].nodes[0]).toEqual({ id: "n1", name: "🇯🇵 节点", protocol: "", included: true, delivery: "unsupported", clientSupport: "unknown", reason: "" });
    expect(JSON.stringify(report)).not.toContain("vless://");
    expect(JSON.stringify(report)).not.toContain("secret-token");
  });
  it("creates country flags and unique tags", () => {
    expect(flag("jp")).toBe("🇯🇵");
    expect(splitTags("自用, 高速，自用")).toEqual(["自用", "高速"]);
  });
  it("infers external subscription countries without overriding assigned hosts", () => {
    expect(inferNodeCountryCode({ name: "🇺🇸 United States 03", uri: "vless://id@us3.example.com:443" })).toBe("US");
    expect(inferNodeCountryCode({ name: "东京 IPLC 02", uri: "ss://payload@example.com:443" })).toBe("JP");
    expect(inferNodeCountryCode({ name: "London Premium", uri: "trojan://id@uk-1.example.com:443" })).toBe("GB");
    expect(inferNodeCountryCode({ name: "United States 03" }, { countryCode: "SG" })).toBe("SG");
    expect(inferNodeCountryCode({ name: "剩余流量 100 GB" })).toBe("");
  });
  it("prefers a routable Komari address and rejects private fallbacks", () => {
    expect(preferredPublicHost({ ipv4: "203.0.113.8", ipv6: "2001:db8::8" })).toBe("203.0.113.8");
    expect(preferredPublicHost({ ipv4: "10.0.0.8", ipv6: "2001:db8::8" })).toBe("2001:db8::8");
    expect(preferredPublicHost({ ipv4: "192.168.1.2", ipv6: "fd00::2" })).toBe("");
  });
  it("repairs a partial discovery result without guessing advanced fields", () => {
    const uri = buildRepairUri({ protocol: "vless", publicHost: "2001:db8::8", port: 443, credential: "00000000-0000-4000-8000-000000000008", name: "东京 Reality", sni: "www.example.com", realityPublicKey: "public-key", shortId: "abcd", flow: "xtls-rprx-vision" });
    expect(uri).toContain("@[2001:db8::8]:443?");
    expect(new URL(uri).searchParams.get("security")).toBe("reality");
    expect(decodeURIComponent(new URL(uri).hash.slice(1))).toBe("东京 Reality");
    expect(() => buildRepairUri({ protocol: "unknown", publicHost: "example.com", port: 443, credential: "secret" })).toThrow(/直接粘贴/);
  });
  it("exports browser-generated X25519 keys as raw base64url", async () => {
    const privatePkcs8 = new Uint8Array(48);
    privatePkcs8.fill(1, 16);
    const publicRaw = new Uint8Array(32).fill(2);
    const fakeCrypto = {
      subtle: {
        generateKey: async () => ({ privateKey: {}, publicKey: {} }),
        exportKey: async (format) =>
          format === "pkcs8" ? privatePkcs8.buffer : publicRaw.buffer,
      },
    };
    const keys = await generateRealityKeypair(fakeCrypto);
    expect(keys.realityPrivateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(keys.realityPublicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("keeps expiry dates in the browser's local calendar day", () => {
    expect(localDateInput(new Date(2026, 8, 4, 23, 59, 59).toISOString())).toBe(
      "2026-09-04",
    );
    expect(localDateInput("invalid")).toBe("");
  });
  it("shows only Nowhere settings supported by the selected release", () => {
    expect(nowhereVersionCapabilities("v1.8.3")).toMatchObject({ supported: false, verified: false });
    expect(nowhereVersionCapabilities("v2.0.1")).toMatchObject({ supported: true, verified: true, localTelemetry: false });
    expect(nowhereVersionCapabilities("v2.0.2")).toMatchObject({ supported: true, verified: true, adapter: "nowhere-v2", isV2: true, protocolGeneration: 2, wireProtocol: "nw2", carrierEndpoints: true, morph: true, localTelemetry: true, transportMemoryProfile: true });
    expect(nowhereVersionCapabilities("v3.0.0")).toMatchObject({ known: true, supported: false, verified: false, protocolGeneration: 0 });
    expect(nowhereVersionCapabilities("latest").known).toBe(false);
  });
  it("reorders without mutating", () => {
    const input = ["a", "b", "c"];
    expect(moveItem(input, 0, 2)).toEqual(["b", "c", "a"]);
    expect(input).toEqual(["a", "b", "c"]);
  });
  it("uses the lossless Anywhere feed for Android Anywhere QR imports", () => {
    const state = { settings: { publicBaseUrl: "https://sub.example.com" } };
    const subscription = { token: "abc" };
    expect(androidAnywhereLink(state, subscription)).toBe(
      "https://sub.example.com/proxy/sub/abc?format=anywhere",
    );
  });
  it("normalizes only legacy percent-encoded node names", () => {
    expect(normalizeNodeName("%E4%B8%9C%E4%BA%AC%20%C2%B7%20Nowhere")).toBe(
      "东京 · Nowhere",
    );
    expect(normalizeNodeName("literal%20name")).toBe("literal%20name");
  });
  it("keeps only stable Nowhere releases and sorts them semantically", () => {
    expect(
      normalizeNowhereReleases([
        { tag_name: "v2.0.2", published_at: "2026-09-18T00:00:00Z" },
        { tag_name: "v2.0.0", published_at: "2026-09-11T00:00:00Z" },
        { tag_name: "v1.8.2", published_at: "2026-08-25T00:00:00Z" },
        { tag_name: "v1.8.3", published_at: "2026-09-01T00:00:00Z" },
        { tag_name: "v1.8.3" },
        { tag_name: "v1.9.0-rc.1", prerelease: true },
        { tag_name: "v1.4.0" },
      ]).map((release) => release.tag),
    ).toEqual(["v2.0.2", "v2.0.0"]);
  });
  it("normalizes official stable sing-box releases without a v prefix", () => {
    expect(normalizeSingBoxReleases([
      { tag_name: "v1.13.9" }, { tag_name: "1.14.0-beta.1", prerelease: true }, { tag_name: "v1.13.11" }, { tag_name: "v1.13.11" },
    ]).map((release) => release.tag)).toEqual(["1.13.11", "1.13.9"]);
  });
  it("builds deterministic names and distinguishes Nowhere transports", () => {
    const machines = [
      {
        id: "jp",
        countryCode: "JP",
        country: "日本",
        region: "东京",
        provider: "Oracle",
        name: "Oracle 东京",
      },
    ];
    const nodes = [
      {
        id: "a",
        machineId: "jp",
        name: "old-a",
        protocol: "nowhere",
        uri: "nowhere://key@example.com:1?up=udp&down=udp",
      },
      {
        id: "b",
        machineId: "jp",
        name: "old-b",
        protocol: "nowhere",
        uri: "nowhere://key@example.com:2?up=tcp&down=udp",
      },
    ];
    const result = templateNodeNames(nodes, machines);
    expect(result.map((node) => node.name)).toEqual([
      "🇯🇵 | 日本 | Oracle | Nowhere QUIC 01",
      "🇯🇵 | 日本 | Oracle | Nowhere TCP→UDP 01",
    ]);
    expect(protocolLabel(nodes[1])).toBe("Nowhere TCP→UDP");
    const freeform = templateNodeNames(nodes, machines, {
      template: "{provider}",
    });
    expect(freeform.map((node) => node.name)).toEqual(["Oracle", "Oracle (2)"]);
  });
  it("evaluates per-server traffic directions, remaining quota and forecast", () => {
    const now = Date.UTC(2026, 8, 16);
    const plan = { enabled: true, limitBytes: 1000, accounting: "sum", resetDay: 1, warningLevels: [70, 90, 100] };
    expect(evaluateTrafficPlan(plan, { up: 200, down: 600 }, now)).toMatchObject({ usedBytes: 800, remainingBytes: 200, state: "warning", forecastRisk: true });
    expect(evaluateTrafficPlan({ ...plan, accounting: "max" }, { up: 200, down: 600 }, now)).toMatchObject({ usedBytes: 600, state: "healthy" });
    expect(evaluateTrafficPlan({ ...plan, accounting: "up" }, { up: 950, down: 20 }, now)).toMatchObject({ usedBytes: 950, state: "critical" });
    expect(evaluateTrafficPlan({ ...plan, accounting: "down" }, { up: 950, down: 1001 }, now)).toMatchObject({ usedBytes: 1001, remainingBytes: 0, state: "exceeded" });
  });
  it("uses UTC monthly boundaries and follows Agent short-month rollover", () => {
    const february = trafficPlanCycle(31, Date.UTC(2027, 1, 15));
    expect(new Date(february.start).toISOString()).toBe("2027-01-31T00:00:00.000Z");
    expect(new Date(february.end).toISOString()).toBe("2027-03-01T00:00:00.000Z");
    const march = trafficPlanCycle(31, Date.UTC(2027, 2, 15));
    expect(new Date(march.start).toISOString()).toBe("2027-03-01T00:00:00.000Z");
    expect(new Date(march.end).toISOString()).toBe("2027-03-31T00:00:00.000Z");
  });
});
