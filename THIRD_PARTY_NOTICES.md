# Third-party notices

[简体中文](THIRD_PARTY_NOTICES.zh-CN.md)

Wherever Station itself is licensed under GPL-3.0-only. The notices below cover separately licensed third-party components distributed with or used to build the plugin.

The administrative UI is built from the following unmodified npm packages. They are bundled into `pages/assets` by Vite; their licenses remain with their respective authors.

| Package | Purpose | License |
| --- | --- | --- |
| React / React DOM | Component rendering | MIT |
| TanStack Table | Node table model | MIT |
| dnd-kit | Accessible drag-and-drop interaction | MIT |
| Lucide React | SVG interface icons | ISC |
| qrcode.react | Local subscription QR rendering | ISC |
| Vite / React plugin | Build tooling (not shipped as a runtime service) | MIT |
| Vitest | Test tooling | MIT |
| js-yaml | Safe YAML parsing for Clash/Mihomo subscription import | MIT |
| argparse | js-yaml runtime dependency | Python-2.0 |

Copyright and license texts for packaged npm dependencies are included with those packages in the release archive. External services, panels, proxy kernels, and client applications are not redistributed by this notice.

The optional “IP profile” action downloads and runs a checksum-pinned copy of `dy0422/ipcheck-plus` on the selected server. It is not bundled into the plugin archive. That project is licensed under MIT; its upstream source and license remain available at <https://github.com/dy0422/ipcheck-plus>.

The optional provider-region lookup resolves endpoint hostnames through Cloudflare's DNS-over-HTTPS endpoint, then sends the resolved public IP addresses to the hosted [country.is](https://country.is/) API. No provider token or share URI is sent to country.is. country.is is open source under the MIT License.
