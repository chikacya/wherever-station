# User guide

[简体中文](USER_GUIDE.zh-CN.md)

## Choose a starting point

The empty workspace offers three independent paths:

1. **Import nodes** when you already have client URIs, a Base64 list, or Clash/Mihomo YAML.
2. **Connect a provider** when S-UI or 2S-UI already owns the sing-box configuration.
3. **Attach a VPS** when you need Komari monitoring, service discovery, connectivity checks, or managed deployment.

A node does not need a server assignment to appear in a subscription.

## Servers and traffic

The server workspace combines Komari metrics with Wherever Station metadata. Selecting a server shows live upload/download, CPU, memory, disk, a 24-hour trend, and any recognized proxy services.

Server traffic plans are optional. Configure a quota, accounting mode (`upload + download`, maximum direction, upload only, or download only), reset day, and warning thresholds. The plan uses Komari Agent counters and can synchronize Komari's client traffic limit. Exceeding a server plan shows a warning; it does not stop a process or disable a subscription.

Server traffic plans and subscription quotas are separate:

- A server plan describes the VPS network allowance.
- A subscription quota controls whether one public subscription URL remains available.

Use **Discover nodes** to inspect existing sing-box or Nowhere services. Discovery never changes their configuration. A candidate with incomplete public address, credentials, TLS, or Reality data remains a repair draft. A complete Nowhere result can first create a stopped adoption copy, followed by an explicit switch from the deployment page; staging the copy does not stop the original service.

The optional **IP quality / service access** check runs a built-in concurrent probe on the selected Agent. It identifies the IPv4 exit and any available IPv6 exit separately, then provides a compact purity score, datacenter/residential classification, proxy signal, agreement across multiple egress sources, plus availability and response time for common streaming and AI services. This is a quick in-panel reference rather than a replacement for a specialist test site; the bounded probe runs only on demand and does not stay resident.

## Node library

The import dialog accepts:

- one or more client URIs;
- a Base64-encoded URI list;
- Clash/Mihomo YAML.

Review the parse result before saving. The optional server field is only for organization and remote actions.

The node library supports direct URI copy, a single-node QR code, filters, ordering, bulk enable/disable, tags, server reassignment, regular-expression replacement, and naming templates. A default name follows the selected server until the name is edited manually. The header privacy mode masks node addresses, server IPs, and source URLs before taking a screenshot without changing saved data.

Unknown URI schemes are stored as opaque values. They can be sent through URI-based outputs but are not automatically converted to structured formats.

## External subscription sources

Add an HTTP(S) airport or self-hosted subscription in **Sources**. Synchronization runs from the Komari server; the optional server assignment does not proxy the request.

The first synchronization creates nodes. Later synchronizations match normalized connection fingerprints; a connection already represented by discovery or another source is skipped rather than duplicated. Missing upstream nodes are disabled instead of deleted. If the response contains `Subscription-Userinfo`, the source card shows upload, download, remaining traffic, and expiry.

Source URLs are credentials. Avoid screenshots, logs, or issue reports that reveal them.

## Build a subscription

1. Create a subscription and select nodes.
2. Order nodes by click or drag.
3. Optionally create `select`, `url-test`, `fallback`, or `load-balance` groups.
4. Optionally add built-in routing behavior, custom rules, or cached rule sets.
5. Preview changes and format compatibility.
6. Save, then copy the URL or QR code for the intended client.

Proxy groups and rules apply to structured Mihomo, Surge, Loon, and sing-box output. Anywhere and other URI-list clients receive nodes without those structures.

Subscription availability can be unlimited, manually metered, linked to one external source, or linked to one provider client. Expiry or quota exhaustion disables only the public subscription response. Stored nodes and proxy processes keep running.

Use device profiles to remember the intended client and recommended output format. Always read the preflight report: unsupported protocols are skipped from structured output instead of being approximated.

## Managed deployment

The deployment page provides a small set of common sing-box presets and a fuller Nowhere workflow. It is intended for simple isolated instances, not arbitrary sing-box configuration.

Before creating an instance:

- select an Agent-backed server;
- verify the public hostname or IP and an unused port;
- select a binary source and version;
- choose a certificate mode where TLS is required;
- review the generated plan.

Creation leaves the service stopped. Start it explicitly, open the required firewall port yourself, and run a real connectivity check.

VLESS Reality does not require a domain or deployed PEM certificate, but it still depends on a Reality key pair, SNI, and a TLS handshake target. Hysteria2, TUIC, Trojan, and AnyTLS require either a trusted certificate or explicit private-certificate trust on the client.

## Certificates

The certificate workspace is scoped by server:

- **Stable self-signed** creates a certificate and private key in the managed certificate directory.
- **Existing PEM** stores absolute paths and checks readability, key match, SANs, fingerprints, and expiry.
- **Ephemeral Nowhere TLS** is convenient for testing but its fingerprint can change after restart.

Private-key contents are not returned to the browser or stored in plugin state. A certificate referenced by an instance cannot be deleted until the instance is moved to another certificate.

Wherever Station does not issue public ACME certificates. Use an ACME client or a specialist panel, then register the generated PEM paths.

## S-UI and 2S-UI

Create an API token in the remote panel, then add its HTTPS base URL, panel path, type, and token under **Providers**. Connection checks and synchronization use `/apiv2` and are read-only.

Wherever Station imports the share links exposed by panel clients. An inbound without a client/share link is not a complete node. Finish the client assignment in the original panel, then synchronize again.

Provider nodes can be assigned a display region without assigning a VPS. **Identify regions** resolves each node hostname and sends only the resulting public IP addresses to the geolocation service; the ISO country and ASN are stored as node metadata and do not modify the share URI.

When a previously synchronized remote node disappears, choose whether to disable and retain it, delete the local record, or detach it as a manual node. Remote protocol, user, route, and certificate changes still belong in the original panel.

## Status, telemetry, and connectivity

These signals answer different questions:

- **Service status**: is the process running?
- **Telemetry**: what is this known process doing now?
- **Connectivity check**: can a real client configuration complete a request?

Nowhere exposes protocol telemetry when its version supports the required interface. sing-box cards show process-level CPU, memory, PID, and traffic evidence available from the host. Connectivity checks run on a selected Agent, use a temporary client, and are not continuous benchmarking.

## Settings and drafts

Global settings contain cross-page preferences and **Backup & migration**. Download a JSON backup before moving the plugin, then select it in the new installation, review the replacement counts, and confirm restore. The backup includes node URIs, subscription tokens, provider API tokens, and cached rule sets: keep the file private.

Restore replaces plugin records only. It does not install Komari Agents, move certificate/private-key files or proxy binaries, or start/stop services. After moving to another Komari installation, review Agent bindings, the public subscription base URL, certificate paths, and managed-instance status before operating those instances. Export a fresh backup before replacing existing data.

Node, certificate, provider, and instance options remain in their own workflows.

Long editors keep an unfinished draft in the current browser tab. Closing and reopening the editor restores it; saving or choosing **Discard draft** removes it. Provider API tokens are deliberately excluded. Closing the browser tab clears session drafts.
