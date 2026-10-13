# Nowhere integration

[简体中文](NOWHERE.zh-CN.md)

Wherever Station manages Nowhere without requiring `nowhere-sh`. It owns installation, configuration, service lifecycle, telemetry, certificates, and share URI generation for instances created through the plugin. NW2 uses 2.2.1 as its installed baseline. New instances default to NW3 3.0.0.

## Continuous compatibility

Nowhere may change its command line, configuration, transport, or URI contract between releases. Wherever Station continuously tracks stable upstream releases, but writable operations use the explicit adapter catalog in [`tools/nowhere-compatibility.json`](../tools/nowhere-compatibility.json), not a “newer means compatible” assumption.

| State | Behaviour |
| --- | --- |
| `verified` | The exact release is in the regression matrix. Supported lifecycle and migration operations are enabled. |
| `compatible-range` | A compatible family is recognized, but the exact release has not been verified. Identification stays available; writes are blocked. |
| `unknown-adapter` | No adapter exists. The version and instance record are retained without generated commands or configuration. |

The catalog file is the authoritative support list. Documentation intentionally does not pin a version number because verified support advances with upstream releases.

## Releases and upgrades

The version selector reads official GitHub releases, while compatibility status comes from the local adapter catalog. A newly discovered release remains read-only until its assets, checksums, CLI, configuration, URI, lifecycle, telemetry, migration, and rollback behaviour have passed isolated regression tests. The scheduled release check reports stable upstream versions missing from the catalog, so maintenance starts without silently exposing unverified writes.

Downloads are verified against the checksum supplied by the official release when available. An upgrade changes only the selected managed instance and retains rollback metadata.

Before editing, a managed instance reads its current configuration from the target host. Connection, carrier, client-output, certificate and advanced runtime fields are then applied with a configuration fingerprint to prevent overwriting concurrent changes; failure restores the previous configuration. Host assignment, instance identity, binary source and adoption provenance belong to separate lifecycle controls. Creation and editing share the same advanced field definitions. Not-yet-standardized upstream variables can be retained under **Experimental environment variables**, which should only be used when explicitly required by the official Nowhere documentation.

## Certificates and telemetry

Managed Nowhere instances can reference uploaded certificates or plugin-generated self-signed certificates. Certificate ownership, fingerprint, validity, and renewal state are shown with the instance. Publicly trusted ACME certificates should be issued by a dedicated certificate service or panel and then referenced here.

Process state and traffic telemetry are collected independently of Komari host metrics. Since Nowhere 2.0.2, Wherever Station discovers the instance's protected registry and subscribes to summary snapshots through its local Unix socket; it does not open or reserve a TCP telemetry port. A missing sample does not imply that the host is offline.

## Existing installations

Discovery is conservative. A complete, supported definition can be imported; incomplete findings become repair drafts so that credentials, public address, or certificate information are never guessed.

A fully readable Nowhere service may be **adopted**. Adoption has two explicit steps: first copy the current binary and configuration into a separate, stopped managed instance while the original service keeps running; then switch only after the operator has reviewed that instance. A failed switch attempts to restore the original service, and a successful adoption can later be rolled back deliberately. Original service files are never overwritten or deleted. A service that has not completed adoption remains outside the Wherever Station lifecycle boundary.

## Upgrading to Nowhere 2.2.1

Portal and enabled native next-hop keys must contain 32–64 lowercase hexadecimal characters. New instances generate compliant keys. Edit old instances and synchronize every client and next hop before upgrading. The plugin blocks incompatible keys rather than rotating them automatically.

Native Vector, probe and next routes verify the system CA and server name by default. `sni=none` and `pin=none` do not disable verification. Self-signed certificates require their actual leaf certificate SHA256 fingerprint. Managed connectivity checks first read the certificate through the owning Agent. On 2.2.1, the official `fingerprint` command also supports Morph. Refresh ephemeral fingerprints after restarting. UDP-only listeners need a stable certificate with a known fingerprint because fingerprint uses TCP. Anywhere shares support SNI but do not support pin.

Dual-stack outbound sources use `dial4` and `dial6`, accepting local addresses of the matching family or `auto`. The plugin omits `dial` when these fields are used. Reset an existing single-family `dial` to `auto` first.

Existing compliant 32–64 character keys can be retained. The transitional 2.2.0 release is not offered as an installation or upgrade target.

## NW3 3.0.0

NW3 is incompatible with NW2 and provides no negotiation or fallback. Confirm client support, then select NW3 in version management to preview an explicit binary and configuration migration. Separate instances remain available for staged transitions. NW1 and historical NW2 configuration branches are no longer maintained; older NW2 instances retain read, start, stop, restart, delete and upgrade-to-2.2.1 operations.

NW3 requires exactly 32 lowercase hexadecimal key characters and defaults Morph to enabled. Portal supports TLS and QUIC listeners; each Vector connection selects one carrier. Share links use compact endpoints and `net=tcp|udp`; native Vector uses a carrier path and `in=`. Split `up/down`, Mux and native `next` are removed.

Portal output is `direct`, `egress` or a SOCKS5 address. Egress output requires a QUIC listener and forbids explicit source binding. The Egress role connects outbound to the remote Portal over QUIC, using matching credentials and Morph. Configure a trusted SHA256 pin for self-signed Portal certificates. Egress has no local relay listener or subscription node. Loss of Egress does not fall back to direct routing.

NW3 telemetry passively reads Hello and Snapshot without subscription commands. Rates use receive times and lossless cumulative counters; a new instance ID resets the baseline. Only logical TCP/UDP bytes and active Flow counts belong to this IPC contract. Supervisor state remains separate.

Third-party clients require explicit NW3 support; the URI scheme alone does not establish compatibility.

## Batch updates

The deployment page offers a Nowhere batch update preview for installed managed instances. NW2 targets 2.2.1; NW3 targets the latest verified release in its own generation. Drafts, current or newer versions, unbound hosts, staged adoption and existing tasks are skipped. Key/configuration checks never rotate credentials or migrate across generations automatically.

Keep the page open during submission. Once submitted, Agent tasks continue independently of navigation and page reloads; the durable batch record shows processed counts and individual outcomes for 24 hours. One failure does not abort other submitted tasks. Stopped services remain stopped; upgrade failures use existing rollback behavior. Uncertain submission or execution results require review and are never automatically resubmitted. Unmanaged services are outside the batch scope.

## Explicit NW2 to NW3 migration

Select a verified NW3 target in version management. The migration reads current remote configuration, previews conversion and requires coordinated client confirmation. Keep compliant 32-character keys or explicitly choose a replacement; keys are never truncated. Mux, split routes and legacy telemetry settings are removed; SOCKS becomes `out=`. Ports, rates, certificates and Morph switches are preserved. Native `next` requires a redesigned exit and is blocked.

The remote configuration hash is checked before stopping. Failures restore the prior binary, configuration and running/stopped state. Stopped instances briefly start to validate the new configuration, then stop. Only successful migration publishes NW3 subscription links; private `.nw2-backup` files retain the previous binary and environment. NW2 management remains available pending a later explicit decision to remove it.
