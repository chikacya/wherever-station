# 2. Servers tab

[Previous](01-getting-started.md) · [Index](README.md) · [Next: Nodes](03-nodes.md)

The dashboard combines Komari host metrics with Wherever Station metadata and proxy-service evidence. Summary cards show server count, online count, monthly traffic and output-capable nodes. **Current throughput** is the total of all online Agents, while the server card and 24-hour history refer to the selected machine. Monthly bars are selectable and switch the active server.

![Server workspace](../assets/screenshots/overview-light.png)

Use **Onboard VPS** to generate an Agent command from the Komari endpoint and registration key. After the Agent appears, refresh and add display name, ISO country code, region, provider and public address. These fields organize the UI; Client ID remains the authority for remote commands.

Selected-server actions deploy on that host, run read-only discovery, refresh status, edit metadata or remove the plugin record. A traffic plan defines allowance, accounting mode, reset day and warning thresholds. It only warns and may sync a Komari client limit; it never stops services or subscriptions.

The optional IP check shows IPv4 and IPv6 separately, with database locations grouped by the exact address. Network identity and purity apply only to the family named in their header. “Reachable” means an endpoint responded, not that playback, accounts or regional access were verified. Conflicting country databases are marked only when they describe the same address.

Discovery reads services, processes and common configuration without changing the host. Complete candidates can be imported; incomplete TLS, Reality or credential data becomes repair drafts. Native Nowhere discoveries can stage a stopped managed copy before an explicit adoption. Never infer SNI from a listen address.

Native host services can be started, stopped and restarted. Managed services route to the Deploy tab. Nowhere exposes rate/history telemetry when supported; sing-box otherwise shows host process evidence such as CPU, RSS and PID.
