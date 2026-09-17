# Quick start for absolutely everyone

[简体中文](QUICKSTART.zh-CN.md)

Welcome to Wherever Station. You only need one starting path; there is no need to configure every feature.

## Pick a starting point

- Already have `vless://`, `hysteria2://`, `tuic://`, `ss://`, or similar links: install the plugin and choose **Import nodes**.
- Already use S-UI or 2S-UI: choose **Connect external panel** to read its client share links.
- Want VPS metrics or managed deployment as well: attach Komari Agents first, then choose **Attach VPS**.

Agent access is not required when you only organize nodes and publish subscriptions.

## Install from the Komari plugin market

Add `https://raw.githubusercontent.com/chikacya/wherever-station/main/v1.json` under **Plugin Management → Plugin Market → Sources**, refresh the market, then install Wherever Station and review its permissions. The same source lists later releases for manual updates.

## Guided one-command install

Start with a Komari installation that is already reachable over HTTPS, then run this command on your own computer:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chikacya/wherever-station/main/install.sh)
```

The script resolves the latest GitHub Release, downloads the plugin and checksums, verifies SHA256, asks for the Komari address and administrator, then uploads and enables the plugin. It shows the requested permissions before approval and reads the password silently.

To inspect the script before running it:

```bash
curl -fsSLO https://raw.githubusercontent.com/chikacya/wherever-station/main/install.sh
less install.sh
bash install.sh
```

Download and verify without installing:

```bash
bash install.sh --download-only
```

Install a specific release:

```bash
bash install.sh --version 0.67.0
```

## Manual install

1. Open [Releases](https://github.com/chikacya/wherever-station/releases).
2. Download `wherever-station-<version>.zip`.
3. Upload it in Komari plugin management.
4. Review the permissions and enable **Wherever Station**.
5. Open it from the Komari sidebar.

The plugin has no separate hostname: it uses the Komari origin. Open it from the sidebar or use `https://your-komari-host/api/admin/plugin/proxy-console/pages/admin.html` for the full-screen view. Subscription URLs are generated after a subscription is created. Override **Settings → Public base URL** only when subscriptions use a different public hostname.

## Import your first nodes

Open **Nodes**, choose **Bulk import**, paste one or more URIs, a Base64 subscription, or Clash/Mihomo YAML, then review and save. Open **Subscriptions**, create one, select those nodes, and copy the output recommended for Anywhere, Mihomo, Surge, Loon, sing-box, or a generic URI client.

## When attaching VPS hosts

The Komari server and Agents must use mutually compatible versions. Do not let an Agent advance across protocol versions before the server is ready. If host metrics work but service state is unavailable, check both versions first. Updating or rolling back the Komari Agent does not require restarting sing-box or Nowhere.

Managed deployment still requires a correct public address, open port, and firewall rules. Wherever Station does not modify cloud security groups or take over existing proxy configuration automatically.

Continue with the [deployment guide](DEPLOYMENT.md), [user guide](USER_GUIDE.md), or [troubleshooting guide](TROUBLESHOOTING.md).
