# 5. Sources tab

[Previous](04-subscriptions.md) · [Index](README.md) · [Next: Deploy](06-deployment.md)

Add an HTTP(S) node source with name, refresh interval and optional server assignment. The Komari controller fetches it directly; server assignment only organizes imported nodes. URI, Base64 and Clash/Mihomo YAML are accepted.

The first sync creates nodes; later syncs update by normalized connection identity. Duplicates already imported elsewhere are skipped. Upstream removals disable nodes for review instead of silently deleting them. `Subscription-Userinfo`, when present, supplies upload, download, remaining allowance and expiry. A failed refresh preserves the last successful nodes.

Editing changes future syncs. Deleting a source retains its nodes as ordinary external entries. Use Providers for S-UI/2S-UI, and Nodes for one-off lists.

Remote rule sets contain plain domains/CIDRs plus a default proxy/direct/reject action. They participate in subscription rules only after a successful cache refresh. If a later refresh fails, the last successful cache remains active. Deleting a rule set removes its subscription references.
