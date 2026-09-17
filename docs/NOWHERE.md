# Nowhere integration

[简体中文](NOWHERE.zh-CN.md)

Wherever Station manages Nowhere without requiring `nowhere-sh`. It owns installation, configuration, service lifecycle, telemetry, certificates, share URI generation, and supported migrations for instances created through the plugin.

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

## Certificates and telemetry

Managed Nowhere instances can reference uploaded certificates or plugin-generated self-signed certificates. Certificate ownership, fingerprint, validity, and renewal state are shown with the instance. Publicly trusted ACME certificates should be issued by a dedicated certificate service or panel and then referenced here.

Process state and traffic telemetry are collected independently of Komari host metrics. Availability depends on the selected Nowhere generation and the instance's telemetry configuration; a missing sample does not imply that the host is offline.

## Existing installations

Discovery is conservative. A complete, supported definition can be imported; incomplete findings become repair drafts so that credentials, public address, or certificate information are never guessed. Services not created or adopted by Wherever Station remain outside its lifecycle boundary.
