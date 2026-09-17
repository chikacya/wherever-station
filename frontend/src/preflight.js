// Build an offline preflight report with an explicit allow-list. Never copy
// formatter objects wholesale: they may gain sensitive fields in the future.
export function buildPreflightReport(preflight) {
  if (!preflight?.formats?.length) return null;
  return {
    schema: 1,
    subscriptionId: String(preflight.sub?.id || ""),
    subscriptionName: String(preflight.name || preflight.sub?.name || ""),
    generatedAt: new Date().toISOString(),
    formats: preflight.formats.map((item) => ({
      format: String(item.format || ""),
      ok: item.ok === true,
      included: Number(item.included || 0),
      skipped: Number(item.skipped || 0),
      bytes: Number(item.bytes || 0),
      warnings: Array.isArray(item.warnings) ? item.warnings.map((value) => String(value)).slice(0, 50) : [],
      nodes: (Array.isArray(item.nodes) ? item.nodes : []).slice(0, 500).map((node) => ({
        id: String(node.id || ""),
        name: String(node.name || ""),
        protocol: String(node.protocol || ""),
        included: node.included === true,
        delivery: ["converted", "passthrough", "unsupported"].includes(node.delivery) ? node.delivery : "unsupported",
        clientSupport: ["native", "unknown", "unsupported", "not-applicable"].includes(node.clientSupport) ? node.clientSupport : "unknown",
        reason: String(node.reason || ""),
      })),
    })),
  };
}
