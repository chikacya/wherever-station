# Troubleshooting

[简体中文](TROUBLESHOOTING.zh-CN.md)

## Komari Agent is online but no server appears

Komari's Agent record and a Wherever Station server profile must be associated. Open **Servers**, discover unattached Agents, and complete the server profile. If the list is empty, confirm that the Agent has reported to the same Komari installation and reload the plugin.

## Agent is offline

On the target VPS, inspect the Agent unit and recent log:

```bash
sudo systemctl status komari-agent.service --no-pager
sudo journalctl -u komari-agent.service -n 100 --no-pager
```

Typical causes are an unreachable endpoint, a rotated token, an invalid controller certificate, or incorrect system time. Updating the Agent connection does not require restarting proxy services.

## Host metrics and service state refresh at different times

Komari streams host metrics continuously. Wherever Station queries proxy services in host batches when their views are active. Service state can therefore trail CPU and network metrics by one short query cycle. A slow host keeps its most recent sample with a stale marker rather than blocking the fleet.

If host metrics work but service state shows **Unavailable**, verify that the Komari server and Agent versions are protocol-compatible. Do not let Agents automatically advance to a protocol the current server does not support; upgrade the server first or pin the Agent to a compatible version. Wherever Station isolates a failed host query and settles its loading state, but it cannot repair a server-Agent protocol mismatch.

## External source cannot sync

Check that the URL is a complete `http://` or `https://` address, is reachable from the Komari server, returns no more than 1 MiB, and contains share URIs, a Base64 list, or supported Clash/Mihomo YAML. Some providers restrict the source IP, region, or User-Agent. A sync failure keeps the last successful node set.

Traffic allowance appears only when the response supplies a valid `Subscription-Userinfo` header. Missing allowance data does not mean node parsing failed.

## Public subscription is unavailable but nodes still run

When all output nodes (including groups) belong to one Agent-linked VPS, opt in to whole-server traffic display (off by default). This includes other services, not just this subscription. Mixed or unknown ownership suspends display. Statistics failures and traffic exhaustion never block downloads; only expiry or disabling closes the URL.

## A discovered service cannot become a node

Wherever Station does not invent credentials, public addresses, SNI values, Reality keys, or client links. Incomplete findings become repair drafts. Complete the draft with the original panel share URI or verified configuration values; drafts are excluded from every subscription until repaired.

## S-UI or 2S-UI cannot connect or import nodes

Use the complete panel base URL, including scheme, port, and any path prefix. Create an API token in the panel and select the matching provider type. Wherever Station does not use the panel login password.

2S-UI commonly exposes usable share links through clients. An inbound without an associated client can be visible to the panel but provide nothing importable. After adding or binding a client, synchronize again. Enable synchronization cleanup if nodes removed from the remote client should also be removed locally; otherwise they remain intentionally retained.

If the API works but a client connection does not, verify container port publishing, cloud firewall rules, and the host firewall. Validate the result with a real client request, not only process or API status.

## Managed instance creation fails

Read the preflight result and the instance's most recent error. Common causes are a port conflict, missing kernel, unsupported version, or unreadable certificate path. Managed services use instance-specific units:

```bash
sudo journalctl -u 'proxy-console-singbox@INSTANCE_ID.service' -n 100 --no-pager
sudo journalctl -u 'proxy-console-nowhere@INSTANCE_ID.service' -n 100 --no-pager
```

Do not substitute a system-wide `sing-box.service` or `nowhere.service`; unmanaged units are outside the instance boundary.

## Android Anywhere rejects a QR code

Use the Android Anywhere or universal HTTPS code shown in the device section. Custom URL schemes and Unicode fragments are handled differently across platforms. If a name appears percent-encoded, update Anywhere and confirm that the source URI fragment was encoded only once.

## The old UI remains after an upgrade

Confirm that the new plugin version is installed and running in Komari, disable duplicate installations with the same short name, then perform a hard browser refresh. If a reverse proxy caches the plugin API path, purge or bypass that cache.
