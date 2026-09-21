# 6. Deploy tab

[Previous](05-sources.md) · [Index](README.md) · [Next: Providers](07-providers.md)

This page manages isolated instances created or adopted by Wherever Station. It is not a general sing-box expert panel. Entry cards create Nowhere, create sing-box from presets, discover an existing service, open the certificate workspace, or manage presets.

![Managed deployment](../assets/screenshots/deploy-light.png)

Nowhere creation selects server, name, public address, ports, client output, shared key and certificate mode. Advanced fields cover rate limits, dial/SOCKS, logging, telemetry, Vector options, memory profile and binary source. Only releases in the verified compatibility catalog can be deployed. Certificates may be ephemeral, stable self-signed, existing PEM, or a registered asset.

sing-box creation starts from a visible preset, then configures binary source, host, port and protocol-specific Reality/TLS/transport credentials. Presets are convenience specifications, not protocol recommendations. Creation checks port conflicts and runs `sing-box check`. Both flows create stopped services so the user can review before starting.

Instance cards start/stop/restart, test connectivity, add to a subscription, edit runtime configuration, inspect logs, refresh, copy URI, show QR and delete. Nowhere additionally provides version/certificate control and interactive telemetry. Configuration and binary replacement are atomic where supported, with rollback on failure.

Discovery can stage a stopped managed copy of native Nowhere. **Adopt** stops the source unit and starts the managed unit while recording rollback state; **Restore original service** reverses it. Never run both units on the same port.

The certificate workspace generates stable self-signed assets or registers existing PEM paths and checks readability, key match, SAN, fingerprint and expiry. Private-key content never returns to the browser. Publicly trusted certificates remain the responsibility of ACME tooling or an expert panel. Firewall rules are never opened automatically.
