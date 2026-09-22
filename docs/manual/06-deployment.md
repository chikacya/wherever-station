# 6. Deploy tab

[Previous](05-sources.md) · [Index](README.md) · [Next: Providers](07-providers.md)

This page manages isolated instances created or adopted by Wherever Station. It is not a general sing-box expert panel. Entry cards create Nowhere, create sing-box from presets, discover an existing service, open the certificate workspace, or manage presets.

![Managed deployment](../assets/screenshots/deploy-light.png)

Nowhere creation selects server, name, public address, ports, client output, shared key and certificate mode. Shared advanced runtime fields cover rate limits, dial/SOCKS, logging, telemetry, Vector options, Morph and memory profile. A second-level **Experimental environment variables** section is reserved for settings explicitly required by the official Nowhere documentation but not yet represented by the standard form; normal deployments leave it empty. Only releases in the verified compatibility catalog can be deployed. Certificates may be ephemeral, stable self-signed, existing PEM, or a registered asset.

sing-box creation starts from a visible preset, then configures binary source, host, port and protocol-specific Reality/TLS/transport credentials. Presets are convenience specifications, not protocol recommendations. Creation checks port conflicts and runs `sing-box check`. Both flows create stopped services so the user can review before starting.

Instance cards start/stop/restart, test connectivity, add to a subscription, edit runtime configuration, inspect logs, refresh, copy URI, show QR and delete. The Nowhere editor exposes the same connection, carrier, client-output, certificate and advanced runtime fields used during creation. Host assignment, instance identity, binary source and adoption provenance remain immutable there. Nowhere additionally provides version/certificate control and interactive telemetry. Configuration and binary replacement are atomic where supported, with rollback on failure.

Discovery can stage a stopped managed copy of native Nowhere. **Adopt** stops the source unit and starts the managed unit while recording rollback state; the secondary **Exit adoption and restore original service** action reverses it. Managed configuration changes never overwrite the source service configuration. Never run both units on the same port.

The certificate workspace generates stable self-signed assets or registers existing PEM paths and checks readability, key match, SAN, fingerprint and expiry. Private-key content never returns to the browser. Publicly trusted certificates remain the responsibility of ACME tooling or an expert panel. Firewall rules are never opened automatically.
