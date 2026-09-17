import base64
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import sys
import urllib.parse

PAYLOAD = json.loads(base64.b64decode(sys.argv[1], validate=True).decode("utf-8"))
PUBLIC_HOST = str(PAYLOAD.get("publicHost") or "").strip()
MACHINE_NAME = str(PAYLOAD.get("machineName") or "VPS").strip()[:120]


def run(args, timeout=8):
    return subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout, check=False)


def emit(value):
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    print("PCDISCOVERY\t1\t" + base64.b64encode(raw).decode("ascii"))


def clipped(value, limit=240):
    return str(value or "").strip()[:limit]


def stable_id(*values):
    return hashlib.sha256("\0".join(str(value) for value in values).encode("utf-8")).hexdigest()[:20]


def url_host(value):
    value = value.strip().strip("[]")
    return "[" + value + "]" if ":" in value else value


def quote(value):
    return urllib.parse.quote(str(value), safe="")


def parse_env(path):
    values = {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for raw in handle:
                raw = raw.strip()
                if not raw or raw.startswith("#") or "=" not in raw:
                    continue
                key, value = raw.split("=", 1)
                try:
                    parsed = shlex.split(value, posix=True)
                    values[key.strip()] = parsed[0] if parsed else ""
                except ValueError:
                    values[key.strip()] = value.strip().strip("'\"")
    except OSError:
        return {}
    return values


def unit_info(unit):
    wanted = ["LoadState", "ActiveState", "SubState", "FragmentPath", "MainPID"]
    result = run(["systemctl", "show", unit, "--no-pager", *sum((["-p", key] for key in wanted), [])], 6)
    values = {}
    for line in result.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    if values.get("LoadState") == "not-found":
        return None
    return {
        "unit": unit,
        "kind": "nowhere" if "nowhere" in unit.lower() else "sing-box",
        "active": values.get("ActiveState") or "unknown",
        "subState": values.get("SubState") or "unknown",
        "fragmentPath": clipped(values.get("FragmentPath"), 512),
        "pid": int(values.get("MainPID") or 0),
    }


def discover_units():
    names = {"sing-box.service", "nowhere.service"}
    if shutil.which("systemctl"):
        listed = run(["systemctl", "list-unit-files", "--type=service", "--no-legend", "--no-pager"], 8)
        for line in listed.stdout.splitlines():
            name = line.split(None, 1)[0] if line.split() else ""
            lower = name.lower()
            if ("sing-box" in lower or "singbox" in lower or "nowhere" in lower) and not lower.startswith("proxy-console-"):
                names.add(name)
    return [item for item in (unit_info(name) for name in sorted(names)) if item]


def process_args(pid):
    if not pid:
        return []
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as handle:
            return [part.decode("utf-8", "replace") for part in handle.read().split(b"\0") if part]
    except OSError:
        return []


def unit_exec_args(unit):
    args = process_args(unit.get("pid", 0))
    if args:
        return args
    path = unit.get("fragmentPath") or ""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            for raw in handle:
                if raw.strip().startswith("ExecStart="):
                    return shlex.split(raw.strip().split("=", 1)[1])
    except (OSError, ValueError):
        pass
    return []


def config_paths(unit):
    args = unit_exec_args(unit)
    files = []
    directories = []
    for index, value in enumerate(args):
        if value in ("-c", "--config") and index + 1 < len(args):
            files.append(args[index + 1])
        elif value.startswith("--config="):
            files.append(value.split("=", 1)[1])
        elif value in ("-C", "--config-directory") and index + 1 < len(args):
            directories.append(args[index + 1])
        elif value.startswith("--config-directory="):
            directories.append(value.split("=", 1)[1])
    files.extend(["/etc/sing-box/config.json", "/usr/local/etc/sing-box/config.json"])
    for directory in directories:
        try:
            files.extend(os.path.join(directory, name) for name in sorted(os.listdir(directory)) if name.endswith(".json"))
        except OSError:
            continue
    unique = []
    for path in files:
        real = os.path.realpath(path)
        if real not in unique and os.path.isfile(real) and os.path.getsize(real) <= 2 * 1024 * 1024:
            unique.append(real)
    return unique[:50]


def transport_query(inbound):
    transport = inbound.get("transport") if isinstance(inbound.get("transport"), dict) else {}
    kind = str(transport.get("type") or "tcp").lower()
    query = {"type": kind}
    if kind in ("ws", "http", "httpupgrade"):
        if transport.get("path"):
            query["path"] = transport.get("path")
        headers = transport.get("headers") if isinstance(transport.get("headers"), dict) else {}
        host = headers.get("Host") or headers.get("host")
        if isinstance(host, list):
            host = host[0] if host else ""
        if host:
            query["host"] = host
    return query


def query_string(values):
    return urllib.parse.urlencode([(key, str(value)) for key, value in values.items() if value not in (None, "")])


def certificate_readiness(tls):
    certificate_path = clipped(tls.get("certificate_path"), 512)
    key_path = clipped(tls.get("key_path"), 512)
    result = {"path": certificate_path, "keyPath": key_path, "readable": False, "validTo": "", "sans": [], "keyMatch": None}
    if not certificate_path or not key_path or not os.path.isfile(certificate_path) or not os.path.isfile(key_path) or not shutil.which("openssl"):
        return result if certificate_path or key_path else None
    cert = run(["openssl", "x509", "-in", certificate_path, "-noout", "-enddate", "-ext", "subjectAltName"], 6)
    result["readable"] = cert.returncode == 0
    for line in cert.stdout.splitlines():
        if line.startswith("notAfter="):
            result["validTo"] = clipped(line.split("=", 1)[1], 80)
        if "DNS:" in line or "IP Address:" in line:
            result["sans"] = [clipped(part.replace("DNS:", "").replace("IP Address:", ""), 253) for part in line.strip().split(",") if part.strip()][:20]
    cert_key = run(["openssl", "x509", "-in", certificate_path, "-pubkey", "-noout"], 6)
    private_key = run(["openssl", "pkey", "-in", key_path, "-pubout"], 6)
    if cert_key.returncode == 0 and private_key.returncode == 0:
        result["keyMatch"] = hashlib.sha256(cert_key.stdout.encode()).digest() == hashlib.sha256(private_key.stdout.encode()).digest()
    return result


def add_review(reviews, unit, source, inbound, reason):
    protocol = clipped(inbound.get("type"), 32) or "unknown"
    tag = clipped(inbound.get("tag"), 120) or protocol
    tls = inbound.get("tls") if isinstance(inbound.get("tls"), dict) else {}
    users = inbound.get("users") if isinstance(inbound.get("users"), list) else []
    port = int(inbound.get("listen_port") or 0)
    reviews.append({
        "id": stable_id(unit["unit"], source, tag, protocol, reason),
        "kind": "sing-box",
        "protocol": protocol,
        "name": tag,
        "source": source,
        "reason": reason,
        "evidence": [unit["unit"], source, f"listen_port={inbound.get('listen_port') or 0}"],
        "confidence": "confirm" if protocol != "unknown" and port else "draft",
        "repair": {
            "publicHost": PUBLIC_HOST,
            "port": port,
            "sni": clipped(tls.get("server_name"), 253),
            "reality": bool(isinstance(tls.get("reality"), dict) and tls["reality"].get("enabled")),
            "userNames": [clipped(user.get("name") or user.get("username"), 120) for user in users if isinstance(user, dict) and (user.get("name") or user.get("username"))][:20],
            "certificate": certificate_readiness(tls),
        },
    })


def reality_public_key(binary, private_key):
    if not binary or not private_key:
        return ""
    result = run([binary, "generate", "reality-keypair", "--private-key", private_key], 6)
    for line in (result.stdout + "\n" + result.stderr).splitlines():
        if "public" in line.lower() and ":" in line:
            return line.split(":", 1)[1].strip().split()[0]
    return ""


def sing_box_candidates(unit, source, config, candidates, reviews):
    inbounds = config.get("inbounds") if isinstance(config, dict) else None
    if not isinstance(inbounds, list):
        return
    args = unit_exec_args(unit)
    binary = args[0] if args and os.path.isfile(args[0]) else shutil.which("sing-box") or ""
    host = PUBLIC_HOST
    for inbound in inbounds:
        if not isinstance(inbound, dict):
            continue
        protocol = str(inbound.get("type") or "").lower()
        tag = clipped(inbound.get("tag"), 120) or protocol
        port = int(inbound.get("listen_port") or 0)
        if not host or not 1 <= port <= 65535:
            add_review(reviews, unit, source, inbound, "缺少可确认的公网地址或监听端口")
            continue
        tls = inbound.get("tls") if isinstance(inbound.get("tls"), dict) else {}
        users = inbound.get("users") if isinstance(inbound.get("users"), list) else []
        made = []
        if protocol == "shadowsocks":
            entries = users or [inbound]
            for index, user in enumerate(entries):
                method = user.get("method") or inbound.get("method")
                password = user.get("password") or inbound.get("password")
                if not method or not password:
                    continue
                token = base64.urlsafe_b64encode(f"{method}:{password}".encode()).decode().rstrip("=")
                made.append((user.get("name") or tag, f"ss://{token}@{url_host(host)}:{port}#{quote(user.get('name') or tag)}"))
        elif protocol in ("vless", "vmess") and not tls.get("enabled"):
            transport = transport_query(inbound)
            for user in users:
                uuid = user.get("uuid")
                if not uuid:
                    continue
                name = user.get("name") or tag
                if protocol == "vless":
                    made.append((name, f"vless://{quote(uuid)}@{url_host(host)}:{port}?{query_string(transport)}#{quote(name)}"))
                else:
                    vmess = {"v": "2", "ps": name, "add": host, "port": str(port), "id": uuid, "aid": "0", "scy": "auto", "net": transport.get("type", "tcp"), "type": "none", "host": transport.get("host", ""), "path": transport.get("path", ""), "tls": ""}
                    made.append((name, "vmess://" + base64.b64encode(json.dumps(vmess, ensure_ascii=False, separators=(",", ":")).encode()).decode()))
        elif protocol == "vless" and tls.get("enabled") and isinstance(tls.get("reality"), dict) and tls["reality"].get("enabled"):
            reality = tls["reality"]
            public_key = reality_public_key(binary, reality.get("private_key"))
            server_name = (tls.get("server_name") or (reality.get("handshake") or {}).get("server") or "")
            short_ids = reality.get("short_id") or reality.get("short_ids") or []
            short_id = short_ids[0] if isinstance(short_ids, list) and short_ids else short_ids if isinstance(short_ids, str) else ""
            if not public_key or not server_name:
                add_review(reviews, unit, source, inbound, "Reality 公钥或 SNI 无法从运行配置可靠推导")
                continue
            params = transport_query(inbound)
            params.update({"security": "reality", "sni": server_name, "pbk": public_key, "sid": short_id, "fp": "chrome"})
            for user in users:
                uuid = user.get("uuid")
                if not uuid:
                    continue
                name = user.get("name") or tag
                if user.get("flow"):
                    params["flow"] = user.get("flow")
                made.append((name, f"vless://{quote(uuid)}@{url_host(host)}:{port}?{query_string(params)}#{quote(name)}"))
        else:
            add_review(reviews, unit, source, inbound, "该入站包含 TLS 或高级参数，需要在原面板确认客户端配置")
            continue
        if not made:
            add_review(reviews, unit, source, inbound, "配置中缺少可生成客户端链接的用户凭据")
        for index, (name, uri) in enumerate(made):
            candidates.append({"id": stable_id(unit["unit"], source, tag, index, uri.split("#", 1)[0]), "kind": "sing-box", "protocol": protocol, "name": clipped(name, 160), "uri": uri, "source": source, "confidence": "ready", "evidence": [unit["unit"], source, f"inbound={tag}"]})


def discover_sing_box(unit, candidates, reviews):
    paths = config_paths(unit)
    unit["configPaths"] = paths
    if not paths:
        reviews.append({"id": stable_id(unit["unit"], "config-missing"), "kind": "sing-box", "protocol": "unknown", "name": unit["unit"], "source": unit.get("fragmentPath") or unit["unit"], "reason": "已发现服务，但没有找到可读取的 JSON 配置", "evidence": [unit["unit"], unit.get("fragmentPath") or "unit file unavailable"], "confidence": "draft", "repair": {"publicHost": PUBLIC_HOST, "port": 0, "sni": "", "reality": False, "userNames": [], "certificate": None}})
        return
    for source in paths:
        try:
            with open(source, "r", encoding="utf-8") as handle:
                config = json.load(handle)
            sing_box_candidates(unit, source, config, candidates, reviews)
        except (OSError, ValueError, TypeError) as error:
            reviews.append({"id": stable_id(unit["unit"], source, "parse"), "kind": "sing-box", "protocol": "unknown", "name": os.path.basename(source), "source": source, "reason": "配置不是可直接解析的标准 JSON", "evidence": [unit["unit"], source, error.__class__.__name__], "confidence": "draft", "repair": {"publicHost": PUBLIC_HOST, "port": 0, "sni": "", "reality": False, "userNames": [], "certificate": None}})


def discover_nowhere(unit, candidates, reviews):
    paths = ["/etc/nowhere/nowhere.env"]
    fragment = unit.get("fragmentPath") or ""
    try:
        with open(fragment, "r", encoding="utf-8") as handle:
            for raw in handle:
                if raw.strip().startswith("EnvironmentFile="):
                    paths.insert(0, raw.strip().split("=", 1)[1].lstrip("-").strip())
    except OSError:
        pass
    path = next((os.path.realpath(value) for value in paths if os.path.isfile(value)), "")
    unit["configPaths"] = [path] if path else []
    values = parse_env(path) if path else {}
    arguments = unit_exec_args(unit)
    portal_text = next((value for value in arguments if str(value).startswith("portal://")), "")
    if not portal_text:
        portal_text = values.get("NOWHERE_PORTAL") or values.get("NOW_PORTAL") or ""
    portal = None
    portal_query = {}
    if portal_text:
        try:
            portal = urllib.parse.urlsplit(portal_text)
            if portal.scheme != "portal":
                portal = None
            else:
                portal_query = {key: values[-1] for key, values in urllib.parse.parse_qs(portal.query, keep_blank_values=True).items()}
        except (TypeError, ValueError):
            portal = None
    key = values.get("NOWHERE_KEY_VALUE") or (urllib.parse.unquote(portal.username) if portal and portal.username else "")
    port = values.get("NOWHERE_PORT_VALUE") or (portal.port if portal else "")
    bind_host = values.get("NOWHERE_LISTEN_HOST_VALUE") or (portal.hostname if portal else "")
    usable_bind_host = bind_host and bind_host not in ("0.0.0.0", "::", "127.0.0.1", "localhost")
    host = values.get("NOWHERE_PUBLIC_HOST_VALUE") or PUBLIC_HOST or (bind_host if usable_bind_host else "")
    network = values.get("NOWHERE_NET_VALUE") or portal_query.get("net") or "mix"
    args_binary = arguments[0] if arguments else ""
    version = values.get("NOWHERE_VERSION_VALUE") or ""
    if not version and args_binary and os.path.isfile(args_binary):
        checked = run([args_binary, "--version"], 6)
        for token in ((checked.stdout or "") + " " + (checked.stderr or "")).split():
            if token.lstrip("v").split(".")[0].isdigit() and token.count(".") >= 2:
                version = token.strip("(),")
                break
    version = version or "v1.8.0"
    unit["adapter"] = "native-cli"
    unit["binaryVersion"] = clipped(version, 80)
    try:
        numeric_port = int(port)
    except (TypeError, ValueError):
        numeric_port = 0
    if not key or not 1 <= numeric_port <= 65535 or not host:
        missing = []
        if not key:
            missing.append("Shared Key")
        if not host:
            missing.append("公网地址")
        if not numeric_port:
            missing.append("监听端口")
        reviews.append({"id": stable_id(unit["unit"], path, "incomplete"), "kind": "nowhere", "protocol": "nowhere", "name": f"{MACHINE_NAME} Nowhere", "source": path or "运行进程", "reason": "还需补充：" + "、".join(missing), "evidence": [unit["unit"], path or "已读取运行进程参数", "adapter=native-cli"], "confidence": "confirm" if numeric_port else "draft", "repair": {"publicHost": host, "port": numeric_port, "sni": "", "reality": False, "userNames": [], "certificate": None}})
        return
    up = "tcp" if network == "tcp" else "udp"
    down = up
    params = {"up": up, "down": down}
    try:
        numbers = tuple(int(part) for part in version.lstrip("v").split(".")[:3])
    except ValueError:
        numbers = (1, 8, 0)
    if numbers < (1, 8, 0) and up == "tcp":
        params["pool"] = values.get("NOWHERE_POOL_VALUE") or "5"
    alpn = values.get("NOWHERE_ALPN_VALUE") or portal_query.get("alpn") or "now/1"
    if alpn != "now/1":
        params["alpn"] = alpn
    name = f"{MACHINE_NAME} Nowhere"
    uri = f"nowhere://{quote(key)}@{url_host(host)}:{numeric_port}?{query_string(params)}#{quote(name)}"
    tls_mode = values.get("NOWHERE_TLS_VALUE") or portal_query.get("tls") or "1"
    certificate = None
    if str(tls_mode) == "2":
        certificate = certificate_readiness({
            "certificate_path": values.get("NOWHERE_CRT_VALUE") or portal_query.get("crt") or "",
            "key_path": values.get("NOWHERE_TLS_KEY_VALUE") or portal_query.get("key") or "",
        })
    source = path or "运行进程参数"
    candidates.append({"id": stable_id(unit["unit"], source, uri.split("#", 1)[0]), "kind": "nowhere", "protocol": "nowhere", "name": name, "uri": uri, "source": source, "confidence": "ready", "certificate": certificate, "adapter": "native-cli", "evidence": [unit["unit"], source, "adapter=native-cli", f"network={network}", f"version={version}"]})


def main():
    units = discover_units()
    candidates = []
    reviews = []
    for unit in units:
        if unit["kind"] == "nowhere":
            discover_nowhere(unit, candidates, reviews)
        else:
            discover_sing_box(unit, candidates, reviews)
    emit({"ok": True, "publicHost": PUBLIC_HOST, "units": units, "candidates": candidates, "needsReview": reviews})


try:
    main()
except subprocess.TimeoutExpired:
    emit({"ok": False, "error": "扫描系统服务超时"})
except Exception as error:
    emit({"ok": False, "error": clipped(error, 200) or "扫描失败"})
