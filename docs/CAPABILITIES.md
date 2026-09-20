# Capabilities and boundaries

[简体中文](CAPABILITIES.zh-CN.md)

## Product role

Wherever Station is an aggregation layer for a small, self-hosted fleet. It keeps server observability, node metadata, subscription delivery, and a limited managed-instance workflow in one interface.

It deliberately separates three responsibilities:

| Responsibility | System of record |
| --- | --- |
| Server identity, metrics, authentication, Agent connection, remote task transport | Komari |
| Nodes, subscriptions, sources, provider references, traffic plans, managed-instance metadata | Wherever Station |
| Advanced sing-box inbounds, clients, routes, and public-certificate automation | Specialist panel such as S-UI or 2S-UI |

## Relationship with Komari

Wherever Station is a third-party Komari plugin. It uses documented Komari plugin facilities: an iframe administration page, plugin RPC methods, public routes, scheduled jobs, system RPC calls, and the Agent task channel. It does not fork, patch, bundle, or replace Komari.

Komari remains responsible for:

- administrator login and plugin approval;
- Agent registration and online state;
- CPU, memory, disk, network, and history collection;
- transporting explicitly submitted commands to an Agent;
- plugin lifecycle and private storage allocation.

Wherever Station adds domain-specific behavior on top of those facilities. Without Komari, the plugin does not run. Without an Agent, node import and subscription delivery still work, but remote monitoring and operations do not.

The projects have separate licenses and release artifacts. Komari's MIT license does not change Wherever Station's GPL-3.0-only license, and Wherever Station's GPL does not relicense an independently installed Komari server.

## Capability matrix

| Capability | Agent required | Writes remote host |
| --- | ---: | ---: |
| Import/edit URI nodes | No | No |
| Pull external subscription | No | No |
| Build and serve subscriptions | No | No |
| Read S-UI/2S-UI provider links | No | No |
| Show Komari server metrics | Yes | No |
| Discover existing proxy services | Yes | No |
| Inspect IP quality and service access | Yes | Temporary diagnostic files/process only |
| Check a node with a temporary client | Yes | Temporary files/process only |
| Start/stop a recognized existing service | Yes | systemd action after explicit click |
| Create or edit a managed instance | Yes | Isolated instance directory and unit |
| Generate a managed certificate | Yes | Isolated certificate directory |

## State and secret handling

The normal state contains server metadata, node URIs, subscription tokens, source URLs, and managed-instance metadata. S-UI/2S-UI API tokens are kept in a separate server-side secret file with restrictive permissions and are omitted from the normal state response.

Browser session drafts are stored in `sessionStorage`; provider tokens are excluded. QR codes are rendered in the browser. Private-key contents are never sent to the browser or saved in plugin state.

The public subscription route is intentionally unauthenticated and protected by a high-entropy subscription token. Treat every subscription URL as a credential.

## Remote-operation model

Discovery calls are read-only. Mutating operations are generated for one named Agent and are submitted only after an administrator action. Managed create, edit, lifecycle, migration, certificate, and delete operations use request identifiers and persisted task tracking to avoid accidental duplicate execution after a page reload.

Managed files stay under `/var/lib/proxy-console/`. Existing service names and configuration paths are not used as managed targets. A connectivity check uses a temporary client and does not become a resident monitoring process.

## Monitoring semantics

- Server rates and resource usage come from Komari.
- A server traffic plan uses Agent counters and describes a VPS allowance.
- Subscription quota metadata comes from a selected source, provider client, or manual values.
- Process status is not proof of client connectivity.
- Nowhere protocol telemetry is shown only for a known instance and a supported interface.
- Per-node traffic is not claimed when no reliable per-node data source exists.
- Provider-node geography is inferred from the resolved endpoint IP and stored as display metadata; it does not rewrite the connection.

## Intentional limits

Wherever Station does not provide:

- a general-purpose shell or terminal;
- arbitrary sing-box JSON editing;
- automatic ACME/DNS-provider issuance;
- public user registration, plans, billing, or reseller features;
- automatic security-group or firewall changes;
- automatic modification of unknown existing proxy configurations;
- guaranteed conversion of every URI protocol into every structured client format;
- fleet-wide orchestration designed for untrusted tenants.

These limits keep the plugin useful for personal and small shared environments without turning it into a second full proxy panel.
