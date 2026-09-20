# Protocol and output support

[简体中文](PROTOCOLS.zh-CN.md)

Wherever Station separates storing a node from converting it for a particular client. This lets the node library preserve newer or client-specific protocols without pretending every target format can express them.

## Lossless URI outputs

Raw, Base64, and Anywhere outputs preserve any value shaped like `<scheme>://...`. A URI with an unknown scheme is stored and emitted without semantic rewriting. This makes it possible to pass through protocols such as `sudoku://`, `snell://`, or a future scheme to a client that understands it.

Pass-through does not guarantee client compatibility. Preflight reports a known native scheme as `native` and an unlisted scheme as `unknown`; neither classification modifies the URI.

Known native URI schemes currently include:

| Client | Schemes tracked by the catalog |
| --- | --- |
| Anywhere | `nowhere`, `vless`, `hysteria2`, `hy2`, `trojan`, `anytls`, `ss`, `socks5`, `socks`, `sudoku`, `http`, `https`, `quic`, `naive` |
| Loon | `ss`, `ssr`, `vmess`, `vless`, `trojan`, `hysteria2`, `hy2`, `anytls` |

The executable contract is [`tools/protocol-capabilities.js`](../tools/protocol-capabilities.js).

## Structured conversions

Mihomo YAML, sing-box JSON, Surge configuration, and Loon configuration require semantic conversion. Wherever Station emits a node only when its adapter can represent the relevant URI parameters. Unsupported protocols or parameter combinations are reported as skipped rather than guessed.

| Output | Converted URI schemes |
| --- | --- |
| Mihomo | `vless`, `vmess`, `hysteria2`, `tuic`, `anytls`, `trojan`, `ss`, `socks5`, `socks`, `http`, `https` |
| sing-box | `vless`, `vmess`, `hysteria2`, `tuic`, `anytls`, `trojan`, `ss`, `socks5`, `socks`, `http`, `https` |
| Surge | `vmess`, `hysteria2`, `tuic`, `anytls`, `trojan`, `ss`, `socks5`, `socks`, `http`, `https` |
| Loon | `ss`, `ssr`, `vmess`, `vless`, `trojan`, `hysteria2`, `hy2`, `anytls` |

Clash/Mihomo YAML import follows the same rule. Entries that can be reconstructed without losing required values enter the node library; other entries return an item-level error. Prefer the provider's original share URI when available.

Parameter support is narrower than scheme support. The shared [conversion contract](../tools/conversion-contract.js) rejects unknown fields, duplicate query parameters, conflicting aliases, unsupported nested YAML options and certificate pins the target emitter cannot preserve. Unsupported nodes remain available through URI outputs. Known URI renaming changes only the fragment (or VMess display name), not connection parameters.

sing-box rejects fallback/load-balancing groups and the implicit China-direct policy rather than changing their behavior. Surge accepts select and URL-test groups. Loon emits native `[Proxy]` and `[Proxy Group]` sections and accepts select, URL-test, fallback, and load-balance groups. Ambiguous delimiter-bearing names are rejected. VMess conversion never implicitly disables certificate verification. Check subscription preflight before distributing a structured output.

CI and tagged releases share the same verification action: runtime, frontend and Python tests, parameter-mutation tests, three mocked browser acceptance suites, and a pinned sing-box 1.13.18 configuration check. Browser tests run against a temporary local static server without contacting managed servers. The core check verifies syntax, not reachability; Surge and Loon do not have a bundled executable validator.

## Panel and template boundaries

S-UI and 2S-UI connections import client share links exposed by the panel API. An inbound without a usable client link may remain absent or appear as a repair draft; panel runtime state alone is not sufficient to invent credentials.

Built-in sing-box deployment presets intentionally cover a small, tested set of common combinations. They are not a general sing-box configuration editor. Use a dedicated sing-box panel for advanced inbound, routing, certificate, and newly introduced kernel features, then import its share URIs or connect the panel.
