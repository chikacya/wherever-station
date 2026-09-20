import base64
import concurrent.futures
import collections
import json
import re
import sys
import time
import urllib.error
import urllib.request

PREFIX = "PCIPPROFILE\t2\t"
TIMEOUT = 5
MAX_BODY = 512 * 1024
UA = "Mozilla/5.0 (Wherever Station IP Profile)"


def fetch(url, headers=None):
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return response.status, response.read(MAX_BODY).decode("utf-8", "replace"), response.geturl()
    except urllib.error.HTTPError as error:
        return error.code, error.read(MAX_BODY).decode("utf-8", "replace"), url
    except Exception as error:
        return 0, "", f"{type(error).__name__}: {error}"


def fetch_json(url):
    status, body, final_url = fetch(url, {"Accept": "application/json"})
    try:
        return status, json.loads(body), final_url
    except Exception:
        return status, {}, final_url


def safe_text(value, limit=160):
    text = str(value or "").strip()
    return "" if "�" in text else text[:limit]


def first(*values):
    return next((value for value in values if value not in (None, "", [], {})), "")


def number(value):
    try:
        result = float(value)
        return result if result >= 0 else None
    except Exception:
        return None


def boolean(value):
    if isinstance(value, bool):
        return value
    text = str(value or "").strip().lower()
    if text in ("true", "yes", "1"):
        return True
    if text in ("false", "no", "0"):
        return False
    return None


def elapsed_ms(started):
    return max(0, int((time.monotonic() - started) * 1000))


def timed(fn):
    started = time.monotonic()
    return fn(), elapsed_ms(started)


def service(name, status="UNKNOWN", region="", detail="", latency_ms=None):
    return {
        "name": name,
        "status": status,
        "region": safe_text(region, 16).upper(),
        "detail": safe_text(detail, 120),
        "latency_ms": latency_ms,
    }


def chatgpt():
    started = time.monotonic()
    urls = [
        "https://api.openai.com/compliance/cookie_requirements",
        "https://chatgpt.com/cdn-cgi/trace",
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(fetch, urls))
    statuses = [item[0] for item in results]
    body = "\n".join(item[1] for item in results)
    region = (re.search(r"(?:^|\n)loc=([A-Z]{2})(?:\n|$)", body) or ["", ""])[1]
    blocked = any(token in body.lower() for token in ("unsupported_country", "not available in your country"))
    if blocked:
        return service("ChatGPT", "BLOCKED", region, "地区限制", elapsed_ms(started))
    if any(200 <= code < 400 for code in statuses):
        return service("ChatGPT", "AVAILABLE", region, "服务端点可达", elapsed_ms(started))
    return service("ChatGPT", "UNKNOWN", region, "请求未完成", elapsed_ms(started))


def netflix():
    started = time.monotonic()
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda title: fetch(f"https://www.netflix.com/title/{title}"), ("81280792", "70143836")))
    codes = [(status, "NSEZ-404" in body) for status, body, _ in responses]
    if any(status in (200, 301, 302) and not missing for status, missing in codes):
        return service("Netflix", "AVAILABLE", detail="非自制内容可访问", latency_ms=elapsed_ms(started))
    if any(status in (200, 301, 302) for status, _ in codes):
        return service("Netflix", "PARTIAL", detail="仅检测到自制内容能力", latency_ms=elapsed_ms(started))
    if any(status == 403 for status, _ in codes):
        return service("Netflix", "BLOCKED", detail="访问被拒绝", latency_ms=elapsed_ms(started))
    return service("Netflix", "UNKNOWN", detail="请求未完成", latency_ms=elapsed_ms(started))


def youtube():
    started = time.monotonic()
    status, body, _ = fetch("https://www.youtube.com/premium")
    region_match = re.search(r'"contentRegion"\s*:\s*"([A-Z]{2})"', body)
    region = region_match.group(1) if region_match else ""
    lowered = body.lower()
    if status == 200 and "youtube premium is not available" not in lowered:
        return service("YouTube Premium", "AVAILABLE", region, "页面可访问", elapsed_ms(started))
    if status:
        return service("YouTube Premium", "BLOCKED", region, "当前地区不可用", elapsed_ms(started))
    return service("YouTube Premium", "UNKNOWN", detail="请求未完成", latency_ms=elapsed_ms(started))


def tiktok():
    started = time.monotonic()
    status, body, _ = fetch("https://www.tiktok.com/", {"Accept-Language": "en-US,en;q=0.8"})
    match = re.search(r'"(?:region|storeCountry)"\s*:\s*"([A-Z]{2})"', body)
    region = match.group(1) if match else ""
    return service("TikTok", "AVAILABLE" if status == 200 else "UNKNOWN", region, "主页可访问" if status == 200 else "请求未完成", elapsed_ms(started))


def prime_video():
    started = time.monotonic()
    status, body, _ = fetch("https://www.primevideo.com/")
    match = re.search(r'"currentTerritory"\s*:\s*"([A-Z]{2})"', body)
    region = match.group(1) if match else ""
    return service("Prime Video", "AVAILABLE" if status == 200 else "UNKNOWN", region, "页面可访问" if status == 200 else "请求未完成", elapsed_ms(started))


def endpoint(name, url):
    started = time.monotonic()
    status, _, _ = fetch(url)
    if 200 <= status < 500:
        return service(name, "AVAILABLE", detail="服务端点可达", latency_ms=elapsed_ms(started))
    return service(name, "UNKNOWN", detail="请求未完成", latency_ms=elapsed_ms(started))


def main():
    started = time.monotonic()
    discovery = {
        "ippure": lambda: fetch_json("https://my.ippure.com/v1/info"),
        "ipwho": lambda: fetch_json("https://ipwho.is/"),
        "ipapi": lambda: fetch_json("https://api.ipapi.is/"),
        "trace": lambda: fetch("https://www.cloudflare.com/cdn-cgi/trace"),
    }
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(discovery)) as pool:
        futures = {name: pool.submit(timed, fn) for name, fn in discovery.items()}
        raw = {name: future.result() for name, future in futures.items()}

    discovery_values = {name: value[0] for name, value in raw.items()}
    discovery_latency = {name: value[1] for name, value in raw.items()}
    ippure = discovery_values["ippure"][1] if isinstance(discovery_values["ippure"][1], dict) else {}
    ipwho = discovery_values["ipwho"][1] if isinstance(discovery_values["ipwho"][1], dict) else {}
    ipapi = discovery_values["ipapi"][1] if isinstance(discovery_values["ipapi"][1], dict) else {}
    trace = dict(re.findall(r"^([^=\n]+)=([^\n]*)$", discovery_values["trace"][1], re.M))
    ip_candidates = [safe_text(value, 64) for value in (ipwho.get("ip"), ipapi.get("ip"), trace.get("ip"), ippure.get("ip")) if value]
    public_ip = collections.Counter(ip_candidates).most_common(1)[0][0] if ip_candidates else ""
    ippure_for_ip = ippure if safe_text(ippure.get("ip"), 64) == public_ip else {}

    tasks = {
        "proxycheck": lambda: fetch_json(f"https://proxycheck.io/v2/{public_ip}?vpn=1&asn=1&risk=1") if public_ip else (0, {}, ""),
        "ChatGPT": chatgpt,
        "Netflix": netflix,
        "YouTube Premium": youtube,
        "TikTok": tiktok,
        "Prime Video": prime_video,
        "Gemini": lambda: endpoint("Gemini", "https://gemini.google.com/"),
        "Claude": lambda: endpoint("Claude", "https://claude.ai/"),
    }
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(tasks)) as pool:
        futures = {name: pool.submit(fn) for name, fn in tasks.items()}
        checked = {}
        for name, future in futures.items():
            try:
                checked[name] = future.result()
            except Exception as error:
                checked[name] = service(name, "UNKNOWN", detail=f"{type(error).__name__}: 请求未完成")

    proxy_payload = checked.pop("proxycheck")[1]
    proxy = proxy_payload.get(public_ip, {}) if isinstance(proxy_payload, dict) else {}
    ipwho_connection = ipwho.get("connection") or {}
    ipapi_company = ipapi.get("company") or ""
    ipapi_asn = ipapi.get("asn") or ""
    ipapi_location = ipapi.get("location") if isinstance(ipapi.get("location"), dict) else ipapi
    country_code = safe_text(first(ipwho.get("country_code"), ipapi_location.get("country_code"), proxy.get("isocode"), ippure_for_ip.get("countryCode")), 4).upper()
    location = {
        "countryCode": country_code,
        "country": safe_text(first(ipwho.get("country"), ipapi_location.get("country"), proxy.get("country"), ippure_for_ip.get("country"))),
        "region": safe_text(first(ipwho.get("region"), ipapi_location.get("state"), ipapi_location.get("region"), proxy.get("region"), ippure_for_ip.get("region"))),
        "city": safe_text(first(ipwho.get("city"), ipapi_location.get("city"), proxy.get("city"), ippure_for_ip.get("city"))),
        "timezone": safe_text(first((ipwho.get("timezone") or {}).get("id"), ipapi_location.get("timezone"), proxy.get("timezone"), ippure_for_ip.get("timezone"), ippure_for_ip.get("timeZone"))),
        "continent": safe_text(first(ipwho.get("continent"), proxy.get("continent"))),
        "postalCode": safe_text(first(ipwho.get("postal"), proxy.get("postcode"), ippure_for_ip.get("postalCode")), 24),
        "latitude": number(first(ipwho.get("latitude"), ipapi_location.get("lat"), proxy.get("latitude"), ippure_for_ip.get("latitude"))),
        "longitude": number(first(ipwho.get("longitude"), ipapi_location.get("lon"), proxy.get("longitude"), ippure_for_ip.get("longitude"))),
    }
    network = {
        "asn": safe_text(first(ipwho_connection.get("asn"), ipapi_asn.get("asn") if isinstance(ipapi_asn, dict) else ipapi_asn, proxy.get("asn"), ippure_for_ip.get("asn")), 32),
        "organization": safe_text(first(ipwho_connection.get("org"), ipapi_company.get("name") if isinstance(ipapi_company, dict) else ipapi_company, proxy.get("organisation"), ippure_for_ip.get("asOrganization"), ippure_for_ip.get("organization"))),
        "isp": safe_text(first(ipwho_connection.get("isp"), proxy.get("provider"), ipapi_company.get("name") if isinstance(ipapi_company, dict) else ipapi_company)),
        "domain": safe_text(first(ipwho_connection.get("domain"), ipapi_company.get("domain") if isinstance(ipapi_company, dict) else "")),
        "type": safe_text(first(proxy.get("type"), ipapi_company.get("type") if isinstance(ipapi_company, dict) else "")),
        "range": safe_text(proxy.get("range"), 80),
        "ipVersion": safe_text(ipwho.get("type"), 16),
    }
    scores = [value for value in (number(ippure_for_ip.get("fraudScore")), number(proxy.get("risk"))) if value is not None]
    risk_score = max(scores) if scores else None
    risk_level = "high" if risk_score is not None and risk_score >= 70 else "medium" if risk_score is not None and risk_score >= 40 else "low" if risk_score is not None else "unknown"
    proxy_value = str(proxy.get("proxy", "")).lower()
    residential = boolean(ippure_for_ip.get("isResidential"))
    broadcast = boolean(ippure_for_ip.get("isBroadcast"))
    bogon = boolean(ipapi.get("is_bogon"))
    proxy_detected = boolean(proxy.get("proxy"))
    proxy_type = safe_text(proxy.get("type"), 32).upper()
    signals = [
        {"label": "代理", "value": proxy_detected, "state": "warning" if proxy_detected else "good" if proxy_detected is False else "unknown", "detail": proxy_type or "多源识别"},
        {"label": "VPN", "value": True if proxy_type == "VPN" else False if proxy_type else None, "state": "warning" if proxy_type == "VPN" else "good" if proxy_type else "unknown", "detail": "ProxyCheck"},
        {"label": "住宅", "value": residential, "state": "good" if residential else "neutral" if residential is False else "unknown", "detail": "IPPure"},
        {"label": "广播", "value": broadcast, "state": "warning" if broadcast else "good" if broadcast is False else "unknown", "detail": "IPPure"},
        {"label": "Tor", "value": True if proxy_type == "TOR" else False if proxy_type else None, "state": "warning" if proxy_type == "TOR" else "good" if proxy_type else "unknown", "detail": "ProxyCheck"},
        {"label": "保留地址", "value": bogon, "state": "danger" if bogon else "good" if bogon is False else "unknown", "detail": "ipapi.is"},
    ]
    attributes = [
        {"label": "IP 类型", "value": network["ipVersion"] or "待判断"},
        {"label": "网络类型", "value": network["type"] or "待判断"},
        {"label": "时区", "value": location["timezone"] or "待判断"},
        {"label": "网段", "value": network["range"] or "待判断"},
        {"label": "出口一致", "value": "一致" if len(set(ip_candidates)) <= 1 else f"{len(set(ip_candidates))} 个出口"},
    ]
    observations = []
    observation_specs = [
        ("IPWho", ipwho.get("ip"), ipwho.get("country_code"), ipwho.get("city"), discovery_latency.get("ipwho")),
        ("ipapi.is", ipapi.get("ip"), ipapi_location.get("country_code"), ipapi_location.get("city"), discovery_latency.get("ipapi")),
        ("Cloudflare", trace.get("ip"), trace.get("loc"), "", discovery_latency.get("trace")),
        ("IPPure", ippure.get("ip"), ippure.get("countryCode"), ippure.get("city"), discovery_latency.get("ippure")),
    ]
    for source, observed_ip, observed_country, observed_city, latency in observation_specs:
        observed_ip = safe_text(observed_ip, 64)
        observations.append({
            "source": source,
            "ip": observed_ip,
            "countryCode": safe_text(observed_country, 4).upper(),
            "city": safe_text(observed_city, 80),
            "latencyMs": latency,
            "matched": bool(observed_ip and observed_ip == public_ip),
        })
    result = {
        "version": "builtin-2026.09",
        "public_ip": public_ip,
        "elapsed_ms": int((time.monotonic() - started) * 1000),
        "location": location,
        "network": network,
        "risk": {"score": risk_score, "level": risk_level, "proxy": proxy_value or "unknown", "residential": residential},
        "attributes": attributes,
        "signals": signals,
        "observations": observations,
        "services": list(checked.values()),
    }
    payload = base64.b64encode(json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode()).decode()
    print(PREFIX + payload)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(PREFIX + base64.b64encode(json.dumps({"error": safe_text(error, 240)}).encode()).decode())
        sys.exit(1)
