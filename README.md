<p align="center">
  <img src="docs/assets/wherever-station-logo.svg" width="320" alt="Wherever Station">
</p>

# Wherever Station

[简体中文](README.zh-CN.md)

[![CI](https://github.com/chikacya/wherever-station/actions/workflows/ci.yml/badge.svg)](https://github.com/chikacya/wherever-station/actions/workflows/ci.yml)
[![GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-4c6a92.svg)](LICENSE)

Wherever Station is a self-hosted node and subscription workspace for [Komari](https://github.com/komari-monitor/komari). It combines Komari's server inventory, metrics, authentication, and Agent channel with node organization, subscription output, lightweight managed instances, and read-only integration with specialist sing-box panels.

The name reflects the product idea: wherever your servers and nodes are, this is the station where their monitoring, organization, deployment, and subscription needs come together. One station, from anywhere.

Wherever Station is an independent third-party plugin. It is not part of Komari and is not endorsed by the Komari project. No Komari source code is included. Komari is distributed under the MIT License; Wherever Station is distributed under GPL-3.0-only.

## Interface

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/screenshots/overview-dark.png">
    <img src="docs/assets/screenshots/overview-light.png" alt="Wherever Station server workspace" width="1100">
  </picture>
</p>

| Node library | Deployment workspace |
| --- | --- |
| ![Node library](docs/assets/screenshots/nodes-light.png) | ![Deployment workspace](docs/assets/screenshots/deploy-light.png) |

Screenshots use illustrative server and node data.

## What it does

- Shows server health, live upload/download rates, 24-hour trends, monthly counters, and per-server traffic budgets from Komari.
- Imports URI lists, Base64 subscriptions, and Clash/Mihomo YAML; preserves unknown URI schemes without rewriting them.
- Organizes nodes with tags, countries, hosts, bulk rename templates, ordering, direct URI copy, and QR codes.
- Produces Raw URI, Base64, Anywhere, Loon, Mihomo, sing-box, and Surge subscriptions, with compatibility preflight.
- Supports subscription expiry, traffic quotas, token rotation, proxy groups, basic routing rules, and cached remote rule sets.
- Pulls external HTTP(S) subscriptions and standard `Subscription-Userinfo` quota metadata.
- Reads S-UI and 2S-UI `/apiv2` providers without changing their inbounds, users, routes, or services.
- Creates isolated, opt-in sing-box presets and managed Nowhere instances on connected Linux Agents.
- Manages stable self-signed certificates or references existing PEM files for managed instances.
- Tracks current Nowhere 2.x releases through an explicit compatibility catalog and enables lifecycle operations only after verification.

## What it does not do

Wherever Station is not a replacement for a complete sing-box control panel. It does not provide an arbitrary inbound/outbound editor, ACME or DNS-provider automation, multi-tenant billing, public registration, automatic cloud firewall changes, or automatic takeover of unknown production proxy configurations. Use S-UI, 2S-UI, or another specialist panel for advanced sing-box configuration, then synchronize its client share links into Wherever Station.

## Requirements

- Komari `1.4.3` or newer.
- Administrator access to install and approve a Komari plugin.
- Komari Agents only for monitoring, discovery, connectivity checks, service control, or managed deployment. URI import and subscription output work without an Agent.
- For managed deployment: Linux with systemd and Python 3; OpenSSL is required for certificate operations.

## Install

In Komari's **Plugin Management → Plugin Market → Sources**, add:

`https://raw.githubusercontent.com/chikacya/wherever-station/main/v1.json`

Refresh the market and install Wherever Station. New releases can be installed from the same source; review the requested plugin permissions when updating.

Already have a working Komari installation? Run the interactive installer with checksum verification:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chikacya/wherever-station/main/install.sh)
```

Use the manual steps below if you prefer not to execute a network-fetched script, or read the [quick start](docs/QUICKSTART.md) first.

1. Download `wherever-station-<version>.zip` from [Releases](https://github.com/chikacya/wherever-station/releases).
2. Upload it in Komari's plugin manager.
3. Review and approve `node`, `allowRoutes`, and `allowSystemRPC`.
4. Enable the plugin and open **Wherever Station** from the Komari sidebar.
5. Start with one of three independent paths: import existing URIs, connect an S-UI/2S-UI provider, or attach a Komari Agent for monitoring and deployment.

Wherever Station does not create a separate hostname. It reuses Komari's HTTP(S) origin; the [deployment guide](docs/DEPLOYMENT.md#where-the-urls-come-from) explains how its administration, full-screen, and public subscription URLs are formed, along with reverse proxy, Agent, backup, upgrade, and data-directory details.

The Komari server and Agents must remain protocol-compatible. Do not let an Agent advance across protocol versions before the server is ready. If host metrics work but proxy state is unavailable, check both versions first.

## Documentation

| English | 简体中文 | Topic |
| --- | --- | --- |
| [Quick start](docs/QUICKSTART.md) | [快速开始](docs/QUICKSTART.zh-CN.md) | Installation through the first subscription |
| [Deployment](docs/DEPLOYMENT.md) | [部署](docs/DEPLOYMENT.zh-CN.md) | Install, Agent onboarding, backup, upgrade |
| [User guide](docs/USER_GUIDE.md) | [使用指南](docs/USER_GUIDE.zh-CN.md) | Daily workflows and UI concepts |
| [Complete manual](docs/manual/README.md) | [完整用户手册](docs/manual/README.zh-CN.md) | Every tab, control and workflow in separate chapters |
| [Capabilities and boundaries](docs/CAPABILITIES.md) | [能力与边界](docs/CAPABILITIES.zh-CN.md) | Architecture, Komari relationship, permissions |
| [Protocol support](docs/PROTOCOLS.md) | [协议支持](docs/PROTOCOLS.zh-CN.md) | Passthrough and structured conversion |
| [Nowhere support](docs/NOWHERE.md) | [Nowhere 支持](docs/NOWHERE.zh-CN.md) | Versions, lifecycle, local telemetry |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | [排错](docs/TROUBLESHOOTING.zh-CN.md) | Common operational problems |
| [Licensing](docs/LICENSING.md) | [许可说明](docs/LICENSING.zh-CN.md) | GPL, Komari, dependencies, branding |
The internal plugin identifier, data paths, and systemd units retain the earlier `proxy-console` name so existing installations can upgrade in place. It is a stable compatibility identifier; the product name is Wherever Station.

## Isolation and data

Managed instances are written only under:

```text
/var/lib/proxy-console/instances/<instance-id>/
```

Their units are named:

```text
proxy-console-singbox@<instance-id>.service
proxy-console-nowhere@<instance-id>.service
```

They do not overwrite a host's existing `sing-box.service` or `nowhere.service`. Disabling or expiring a subscription does not stop a proxy process. Plugin state and provider secrets live in Komari's plugin data directory and should be backed up with the Komari database. Provider tokens are stored server-side and are not returned by the normal state API.

## Development

```bash
npm ci
npm --prefix frontend ci
npm run ci
```

`npm run ci` audits production dependencies, runs Node, Python, and frontend tests, builds the administration UI, validates release metadata, and creates a deterministic plugin ZIP in `dist/`.

Optional browser checks are under `tools/e2e-*.cjs`. Live tests are opt-in and require explicit target and credential arguments.

## License

Wherever Station is licensed under [GNU GPL version 3 only](LICENSE). Dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Product names such as Komari, sing-box, S-UI, 2S-UI, Nowhere, Anywhere, Mihomo, Surge, and Loon belong to their respective owners and are used only to identify interoperability.

Report security issues privately according to the [security policy](SECURITY.md). Do not paste real subscription links, tokens, private keys, or complete node URIs into a public Issue.
