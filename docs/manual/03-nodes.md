# 3. Nodes tab

[Previous](02-servers.md) · [Index](README.md) · [Next: Subscriptions](04-subscriptions.md)

The node library unifies local imports, sources, providers, discovery and managed deployments. Use **Import nodes** for one or more URIs, then edit a node's name, complete URI, optional server, tags and output state in its row. The URI is authoritative; changing server assignment does not rewrite its host.

![Node management](../assets/screenshots/nodes-light.png)

Bulk import accepts URI lines, Base64 URI lists and Clash/Mihomo YAML. Parse and review before saving. Normalized duplicate connections are skipped. Unknown schemes can be retained losslessly for URI output but cannot be promised in structured formats.

Search by name/address/protocol and filter by region, protocol, source, server or output state. Each node can be enabled for output, copied as a URI, rendered as a QR code, connectivity-tested, edited or deleted. Deleting also removes subscription and group references.

Connectivity checks launch a temporary client on an available Agent and request an HTTPS target. An alternate Agent is preferred to avoid self-connect false positives; the node host is used only when necessary. This is a real proxy test, not a TCP-port probe.

Bulk tools provide naming templates, flag prefixes, regex rename, server reassignment, tag replacement, connectivity testing, enable/disable output and deletion. Discovery drafts can be completed with public address, port, credentials, SNI, Reality data or—preferably—the original complete URI. Drafts never enter subscriptions until validation succeeds.
