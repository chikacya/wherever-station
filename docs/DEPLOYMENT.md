# Deployment

[简体中文](DEPLOYMENT.zh-CN.md)

This guide starts with a Komari server that is already reachable over HTTPS. Replace every example domain and token with your own value.

## 1. Prerequisites

- Komari `1.4.3` or newer.
- Administrator access to Komari's plugin manager.
- A stable HTTPS hostname reachable by browsers, subscription clients, and managed Agents.
- Komari Agent on each server that will provide metrics or accept remote operations.
- Linux, systemd, and Python 3 for managed instance deployment; OpenSSL for certificate operations.

The Komari server does not need to run a proxy. URI import, external subscriptions, provider synchronization, and subscription output do not require an Agent.

## 2. Prepare Komari

Install Komari by following its [official installation guide](https://komari-document.pages.dev/install/quick-start). Put the service behind a valid HTTPS reverse proxy and confirm that the administration page is accessible before installing the plugin.

Do not expose a Komari listener intended for `127.0.0.1` directly to the Internet. Configure authentication, HTTPS, backups, and network access at the Komari layer.

### Where the URLs come from

Wherever Station neither registers a hostname nor starts a separate web service. First give Komari a reachable origin such as `https://monitor.example.com`. A typical self-hosted setup points the hostname's A/AAAA record to the controller VPS and uses Caddy, Nginx, or another reverse proxy to forward HTTPS traffic to Komari's local listening port. `http://IP:port` can be sufficient for a private test, but a stable HTTPS hostname is recommended for access across networks and subscription delivery.

The plugin reuses that origin after installation; it does not need another address:

| Purpose | URL | Access |
| --- | --- | --- |
| Embedded Komari plugin page | `https://monitor.example.com/admin/plugin-page?short=proxy-console&file=pages%2Fadmin.html` | Administrator session required |
| Full-screen page without the Komari sidebar | `https://monitor.example.com/api/admin/plugin/proxy-console/pages/admin.html` | Administrator session required |
| Public subscription | `https://monitor.example.com/proxy/sub/<token>` | Clients holding the subscription token |

Komari creates the sidebar entry from the plugin manifest. The plugin's **Open full screen** control builds the full-screen URL. Wherever Station creates the token and complete subscription URL when a subscription is created. `proxy-console` remains in these paths as an upgrade-compatible internal identifier; it is not a separate product or service.

## 3. Install Wherever Station

In Komari's **Plugin Management → Plugin Market → Sources**, add:

`https://raw.githubusercontent.com/chikacya/wherever-station/main/v1.json`

Refresh the market, choose Wherever Station, and review its permissions. Future releases can be installed from the same source when you choose to update; adding a source does not enable automatic upgrades.

The interactive installer resolves the latest Release, verifies SHA256, signs in to Komari, uploads the archive, and enables the plugin:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chikacya/wherever-station/main/install.sh)
```

Use the manual flow below if you prefer not to execute a network-fetched script. The [quick start](QUICKSTART.md) also shows how to download and inspect it first.

1. Download `wherever-station-<version>.zip` from the project's GitHub Releases page.
2. Upload the ZIP in Komari's plugin manager.
3. Review the manifest and approve the requested permissions.
4. Enable the plugin and confirm that it is running.
5. Open **Wherever Station** from the Komari sidebar.

The requested permissions are:

| Permission | Used for |
| --- | --- |
| `node` | Komari's Node-compatible modules for files, crypto, URLs, and HTTP helpers inside the plugin runtime |
| `allowRoutes` | Public subscription endpoints and the administration page |
| `allowSystemRPC` | Komari client metadata, metrics, remote task submission/results, and traffic-plan synchronization |

These permissions give the plugin administrative capabilities inside Komari. Install releases only from a source you trust and review permission changes during upgrades.

## 4. Attach an Agent

Use **Servers → Add VPS** in Wherever Station or Komari's client manager. With Komari auto-discovery, paste the discovery key into the wizard and run the generated official Agent command on the target server. The key is used in the browser to build the command and is not saved in Wherever Station state.

For a manually created client, the minimal Agent command is:

```bash
./komari-agent \
  --endpoint "https://monitor.example.com" \
  --token "YOUR_AGENT_TOKEN" \
  --month-rotate 1
```

Use a unique Komari token for every Agent. For a long-running installation, store the token in a root-readable environment file and run the Agent as a dedicated systemd service. Current binaries and options are documented by the [Komari Agent project](https://github.com/komari-monitor/komari-agent).

The newest Agent is not automatically compatible with the currently installed server. Review both Komari server and Agent release notes before upgrading; when they cannot be upgraded together, keep a verified pair and disable Agent auto-update. Wherever Station isolates a failed Agent status query, but cannot repair an incompatible transport protocol between the two components.

`--month-rotate` accepts a day from 1 to 31. Match it to the server's traffic reset day in Wherever Station if monthly counters are used. Changing the Agent option requires restarting only the Agent, not sing-box or Nowhere.

When the Agent appears in Komari, return to Wherever Station and add its display metadata: name, provider, country code, region, and tags. A Komari Agent and a Wherever Station server record are separate objects. Removing one does not uninstall software represented by the other.

## 5. Public subscription address

Open **Settings** and set a public base URL that subscription clients can reach:

```text
https://monitor.example.com
```

Subscription URLs use the plugin's public route, not the administration iframe URL. If the field is empty, Wherever Station uses the current Komari origin. Changing the Komari hostname or public IP may invalidate existing links until the base URL is updated.

Leave this field empty when the Komari administration page and subscription clients use the same public hostname. Set it only when subscriptions are served through a CDN, a dedicated subscription hostname, or another reverse-proxy entry point. The setting accepts an existing base URL; it does not purchase a domain, change DNS, or issue a certificate.

## 6. Existing services and managed deployment

**Discover nodes** is read-only. It inspects systemd metadata, process arguments, and readable configuration evidence. It does not start, stop, restart, or rewrite an existing proxy service. Complete candidates can be imported; incomplete candidates remain repair drafts until a valid client URI is supplied.

Managed instances use isolated directories and unit names:

```text
/var/lib/proxy-console/instances/<instance-id>/
proxy-console-singbox@<instance-id>.service
proxy-console-nowhere@<instance-id>.service
```

Creation defaults to stopped. The user must explicitly start the instance. Cloud security groups and host firewalls are not modified.

## 7. Data and backups

Komari determines its own data directory at startup. Wherever Station stores state under:

```text
<komari-data>/plugin-data/proxy-console/
```

Back up the Komari database and this plugin-data directory together. If certificate assets were generated on an Agent, also back up:

```text
/var/lib/proxy-console/certificates/
/var/lib/proxy-console/instances/
```

Provider tokens and subscription source URLs are credentials. Protect backups accordingly. Never commit state files, tokens, private keys, or subscription URLs to Git.

## 8. Upgrade and rollback

1. Back up Komari and plugin data.
2. Upload the new ZIP in Komari's plugin manager.
3. Review any permission changes and enable the new version.
4. Confirm plugin status, server metrics, subscriptions, and managed instance cards.

A plugin upgrade does not automatically upgrade managed sing-box or Nowhere binaries, and it does not perform major-version migrations. Those remain explicit instance operations with their own compatibility checks.

If the plugin cannot start, reinstall the previous ZIP and restore plugin data from the matching backup if the data schema changed. Do not delete `/var/lib/proxy-console/instances/` as a rollback method.

## 9. First-use checklist

- Komari is reachable through valid HTTPS.
- The plugin is enabled and running.
- Imported nodes or an external provider are visible.
- Any attached Agent reports current metrics.
- The public subscription base URL resolves from the intended client network.
- Subscription preflight reports the expected formats and skipped protocols.
- Managed instances, if used, pass a real connectivity check after their ports are opened.
