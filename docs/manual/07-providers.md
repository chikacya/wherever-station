# 7. Providers tab

[Previous](06-deployment.md) · [Index](README.md) · [Next: Settings](08-settings.md)

Providers connect S-UI and 2S-UI read-only. Enter a display name, type, HTTPS root, optional panel path and API token. Save checks `/apiv2`; tokens stay server-side and an empty token during editing keeps the existing secret.

**Check** verifies API access. **Sync** first previews creates, updates, unchanged entries and remote removals, then applies only selected changes. **Identify region** resolves a node hostname to public IP and stores ISO country/ASN without changing the URI. You can also open, edit or delete the provider.

2S-UI normally exposes share links through clients bound to inbounds; an inbound without a client is not a complete node. Wherever Station imports only complete links actually returned by the API and never edits remote users, protocols, certificates or routing.

Expanded provider nodes can be copied, shown as QR codes or located in the node library. When a remote node disappears, choose whether to disable and keep, delete locally, or detach it into a manual node. Region lookup is an organizational hint rather than authoritative physical location; assign a Wherever Station server separately when VPS grouping is needed.
