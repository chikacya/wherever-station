# Nowhere integration

[简体中文](NOWHERE.zh-CN.md)

Wherever Station manages Nowhere without requiring `nowhere-sh`. It owns installation, configuration, service lifecycle, telemetry, certificates, and share URI generation for instances created through the plugin. Only NW3 is supported; new instances default to stable v3.1.0. NW2 adapters, management and migration have been removed; historical records and backups are preserved.

## Continuous compatibility

Nowhere may change its command line, configuration, transport, or URI contract between releases. Wherever Station continuously tracks stable upstream releases, but writable operations use the explicit adapter catalog in [`tools/nowhere-compatibility.json`](../tools/nowhere-compatibility.json), not a “newer means compatible” assumption.

| State | Behaviour |
| --- | --- |
| `verified` | The exact release is in the regression matrix. Supported lifecycle and same-generation upgrade operations are enabled. |
| `compatible-range` | A compatible family is recognized, but the exact release has not been verified. Identification stays available; writes are blocked. |
| `unknown-adapter` | No adapter exists. The version and instance record are retained without generated commands or configuration. |

The catalog file is the authoritative support list. Documentation intentionally does not pin a version number because verified support advances with upstream releases.

## Releases and upgrades

The version selector reads official GitHub releases, while compatibility status comes from the local adapter catalog. A newly discovered release remains read-only until its assets, checksums, CLI, configuration, URI, lifecycle, telemetry, migration, and rollback behaviour have passed isolated regression tests. The scheduled release check reports stable upstream versions missing from the catalog, so maintenance starts without silently exposing unverified writes.

Downloads are verified against the checksum supplied by the official release when available. An upgrade changes only the selected managed instance and retains rollback metadata.

Before editing, a managed instance reads its current configuration from the target host. Connection, carrier, client-output, certificate and advanced runtime fields are then applied with a configuration fingerprint to prevent overwriting concurrent changes; failure restores the previous configuration. Host assignment, instance identity, binary source and adoption provenance belong to separate lifecycle controls. Creation and editing share the same advanced field definitions. Not-yet-standardized upstream variables can be retained under **Experimental environment variables**, which should only be used when explicitly required by the official Nowhere documentation.

## Certificates and telemetry

Managed Nowhere instances can reference uploaded certificates or plugin-generated self-signed certificates. Certificate ownership, fingerprint, validity, and renewal state are shown with the instance. Publicly trusted ACME certificates should be issued by a dedicated certificate service or panel and then referenced here.

Process state and traffic telemetry are collected independently of Komari host metrics. Wherever Station discovers the NW3 instance's protected registry and passively reads Hello and Snapshot through its local Unix socket; it does not open or reserve a TCP telemetry port. A missing sample does not imply that the host is offline.

## Existing installations

Discovery is conservative. A complete, supported definition can be imported; incomplete findings become repair drafts so that credentials, public address, or certificate information are never guessed.

A fully readable Nowhere service may be **adopted**. Adoption has two explicit steps: first copy the current binary and configuration into a separate, stopped managed instance while the original service keeps running; then switch only after the operator has reviewed that instance. A failed switch attempts to restore the original service, and a successful adoption can later be rolled back deliberately. Original service files are never overwritten or deleted. A service that has not completed adoption remains outside the Wherever Station lifecycle boundary.

## Certificates and connection checks

NW3 requires exactly 32 lowercase hex characters. Native Vector and probes verify certificates; self-signed certificates require the actual leaf SHA256 pin. The plugin reads fingerprints using the instance-owned official `fingerprint` command, including Morph. Ephemeral fingerprints must be refreshed after restart. UDP-only listeners need a stable certificate and known pin.

Dual-stack sources accept `dial4` and `dial6` with the matching address family or `auto`; these options cannot be combined with a non-auto `dial`.

## NW3 3.0.0

Only NW3 can be created, adopted or managed. Historical NW2 records remain visible as unsupported; no remote commands or migration are offered. Existing services and backups are not deleted or upgraded automatically.

NW3 requires exactly 32 lowercase hexadecimal key characters and defaults Morph to enabled. Portal supports TLS and QUIC listeners; each Vector connection selects one carrier. Share links use compact endpoints and `net=tcp|udp`; native Vector uses a carrier path and `in=`. Split `up/down`, Mux and native `next` are removed.

Portal output is `direct`, `egress` or a SOCKS5 address. Egress output requires a QUIC listener and forbids explicit source binding. The Egress role connects outbound to the remote Portal over QUIC, using matching credentials and Morph. Configure a trusted SHA256 pin for self-signed Portal certificates. Egress has no local relay listener or subscription node. Loss of Egress does not fall back to direct routing.

NW3 telemetry passively reads Hello and Snapshot without subscription commands. Rates use receive times and lossless cumulative counters; a new instance ID resets the baseline. Only logical TCP/UDP bytes and active Flow counts belong to this IPC contract. Supervisor state remains separate.

Third-party clients require explicit NW3 support; the URI scheme alone does not establish compatibility.

## Batch updates

The deployment page offers a Nowhere batch update preview for installed managed instances. The selector offers only the two latest verified NW3 releases, including explicitly labeled prereleases. It defaults to a stable release; choosing a prerelease is explicit. Changing the target rebuilds the preview and resets the client compatibility confirmation. Drafts, current or newer versions, unbound hosts, staged adoption and existing tasks are skipped. Key/configuration checks never rotate credentials or migrate across generations automatically.

Keep the page open during submission. Once submitted, Agent tasks continue independently of navigation and page reloads; the durable batch record shows processed counts and individual outcomes for 24 hours. One failure does not abort other submitted tasks. Stopped services remain stopped; upgrade failures use existing rollback behavior. Uncertain submission or execution results require review and are never automatically resubmitted. Unmanaged services are outside the batch scope.

## 3.2.0 admission boundary

3.0.1 introduces Fade; 3.1.0 sends Authenticated Prelude with legacy fallback; 3.2.0 Portal requires it for Morph TCP. Upgrade Morph TCP clients first (native Vector >=3.1.0, or a third-party implementation with explicit support). Single-instance upgrades require confirmation; batches skip affected instances until confirmed. The remote transaction checks its actual URL before stopping. QUIC, non-Morph TCP and QUIC Egress are unaffected by this TCP requirement.

Advanced settings expose fade/full8/low7 generation policies, independently of authentication capability. Existing explicit settings remain intact. Obsolete NOW_UDP_DATA_BUF_SIZE is removed for 3.2.0. Connectivity probes report an outdated native client separately from a server failure.

As checked on 2026-10-28, upstream v3.2.0 is marked prerelease. Default installation and batch updates target stable v3.1.0. Verified v3.2.0 support remains available for deliberate manual selection and does not become an automatic target.


## Prereleases

NW3 prereleases remain visible with an explicit label. Adapted and verified builds can be manually selected for creation or instance upgrades, including verified v3.2.0 in the offline list. Stable defaults still target v3.1.0; batch updates can explicitly select a prerelease from the two latest adapted releases; an existing higher version is not preselected for downgrade. Unadapted builds, including rc/beta tags, are listed but disabled pending adaptation. NW2 management and migration are no longer supported. As checked on 2026-10-29, upstream v3.2.0 is still a prerelease and its authenticated Morph TCP Prelude compatibility checks remain enforced.

Batch targets are validated server-side and persisted with the batch. Running batches cannot change target; reloads retain it. Instances already at or above the selected version are skipped, so batch updates never downgrade them.
