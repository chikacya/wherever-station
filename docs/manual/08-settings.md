# 8. Settings, backup and migration

[Previous](07-providers.md) · [Index](README.md) · [Next: Workflows](09-workflows.md)

The public base URL controls generated subscription hosts. Leave it blank to reuse the current Komari HTTP(S) origin, or set a complete reverse-proxy/subscription origin without credentials. CPU, memory and disk thresholds affect dashboard warnings only. Theme can follow Komari or be fixed to light/dark.

Backup exports server metadata, node URIs, subscriptions and tokens, sources, cached rules, presets, managed-instance metadata, provider connections and API tokens. It does not contain remote binaries, systemd units, certificate/private-key files or Komari Agents. Treat the JSON as a secret.

If an embedded browser blocks downloads, open the full-screen page. If a prepared link still does not download, open it in a new tab via right-click or long-press. The link is short-lived and single-use.

Restore first previews count changes, then completely replaces plugin records. It never modifies VPS files or processes. Concurrent state changes invalidate the preview. After migration, verify Agent Client IDs, public base URL, certificate paths and managed-instance status; refresh and connectivity-test important nodes before client use. A full host migration also needs a separate backup of `/var/lib/proxy-console/` and relevant systemd configuration.
