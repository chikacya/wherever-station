# Anywhere AJSON subscriptions

Implemented against the Anywhere 2.5(411) AJSON parser and documentation, format version 1.

A request carrying `X-Anywhere-Format: ajson/1` receives AJSON on automatic or `format=anywhere` subscription URLs. Old clients retain Base64. Explicit `format=base64` and other client formats remain unchanged. The subscription page also offers `format=ajson` and a `.ajson` download.

The document contains subscription name, existing usage accounting and native structured proxies for Nowhere (NW3), VLESS, Hysteria2, Sudoku, Trojan, AnyTLS, Shadowsocks, SOCKS5 and RFC. Existing node IDs survive renames/reordering. Unknown, duplicate or otherwise ambiguous URI options retain exact keyed links `{id, name, link}`. Unsupported URI schemes are reported as skipped. Missing/duplicate IDs and documents with no compatible nodes fail validation. Token, expiry, quota and no-store rules remain in force.

The first transition from an unkeyed feed rebuilds client identities once; subsequent refreshes keep keyed identities. AJSON does not include groups, DNS, routing, MITM or a Nowhere certificate pin.


The subscription editor includes “Anywhere 原生参数与订阅图标” with a single shared icon upload, preview and removal (PNG/JPEG/WebP, up to 256 KiB), protocol-specific built-in presets and reusable JSON templates, per-node advanced JSON overrides and an authenticated output preview. The same icon is embedded as raw Base64 in `icon.light` and `icon.dark`. Existing icons prefer the light variant, falling back to dark.

Templates contain advanced settings only: addresses, IDs, protocols and credentials cannot be overridden. Existing subscriptions keep their original node parameters by default. Selecting a node immediately offers matching built-in presets, without requiring hand-written JSON. A chosen preset becomes a reusable subscription template, editable in the collapsed template manager. Select a node and optionally a template; per-node settings recursively override template values. Only referenced templates are emitted. Settings persist through saves, subscription history and portable backups and affect AJSON only. Examples include Nowhere morph Prelude, VLESS Reality/ECH and XHTTP, Hysteria Gecko/bandwidth, AnyTLS sessions and Sudoku HTTP masks/multiplexing. They must match the server and client capabilities; no server configuration is changed.

Unknown URI options prevent native overrides on that node, while clearing the override restores the original link. Invalid JSON, unsupported fields and incompatible protocol settings block saving. Full preview JSON contains credentials. The existing Anywhere link and QR code use content negotiation; no separate token is needed.


The ordinary editor shows a server-validated, readable effective configuration and marks inherited versus customized settings. Optional connection settings expose common fields as dropdowns and inputs. JSON and reusable template management live in a collapsed Expert Mode. When switching presets with existing node overrides, an inline choice requires replacing or keeping the current settings; replacement clears old overrides. Resetting a node restores its original connection settings without affecting other nodes. Invalid drafts and unconvertible links are explicitly identified.


The icon field supports local upload and an optional library picker with 14 sources: Orz-3 (four collections), QQ Classic, QureColor All, Semporia, shindgewongxj, TheMagic, tugepaopao, Cute Cartoon, Colorful Static Flags, RageBaby and Characters. Catalog code loads only when opened. Catalogs are fetched on demand, cached in memory for 30 minutes, and browsed 36 icons per page with lazy thumbnails and name search. Cancel/Escape preserves the existing icon and editor; applying modifies the draft until the subscription is saved. Source/author links remain available.

The browser fetches public GitHub/GitLab resources without Komari credentials or subscription tokens. GitLab raw files use the same repository's CORS-enabled API endpoint. Only the chosen image is downloaded for conversion (max 2 MiB, 12-second timeout), scaled to a maximum side of 256 pixels and embedded as PNG for both themes. Catalogs are limited to 1 MiB; embedded icons remain limited to 256 KiB. Client refreshes do not depend on third-party icon hosting.


Text-labeled pagination appears only above the grid, with total count, visible range and page count. Viewport thumbnails use a four-request queue and a bounded image cache; transient errors retry twice. Missing images (404/410) and other load failures have explicit labels instead of question marks. A page-image retry action reloads failed thumbnails while preserving successful cached images. The cache is bounded at 96 images / 12 MiB. Concurrent consumers of the same image share one download; applying an already loaded icon reuses it. Paging and closing cancel obsolete image work.

Subscription cards display the saved embedded icon directly, falling back to the default link icon when absent, removed or undecodable. No third-party image fetch is needed for card rendering.
