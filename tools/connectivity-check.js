const { Buffer } = require("node:buffer");

function buildConnectivityCommand(input = {}) {
  if (!["sing-box", "vector"].includes(input.kind)) throw new Error("Invalid connectivity client kind");
  if (input.kind === "sing-box" && (!input.outbound || typeof input.outbound !== "object")) throw new Error("Missing sing-box outbound");
  if (input.kind === "vector" && !String(input.uri || "").startsWith("vector://")) throw new Error("Missing Vector URI");
  const preferredBinary = String(input.preferredBinary || "");
  if (preferredBinary && !/^\/var\/lib\/proxy-console\/instances\/[A-Za-z0-9_-]{3,80}\/bin\/(?:sing-box|nowhere)$/.test(preferredBinary)) throw new Error("Invalid preferred client binary");
  const payload = {
    kind: input.kind,
    outbound: input.kind === "sing-box" ? input.outbound : null,
    uri: input.kind === "vector" ? String(input.uri) : "",
    expectedIp: String(input.expectedIp || ""),
    preferredBinary,
  };
  const script = String.raw`import base64,json,os,shutil,socket,subprocess,sys,tempfile,time,urllib.parse
P=json.loads(base64.b64decode(sys.argv[1],validate=True).decode())
def emit(v): print("PCCONNECT\t1\t"+base64.b64encode(json.dumps(v,ensure_ascii=False,separators=(",",":")).encode()).decode())
def run(args,timeout=10): return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout,check=False)
def executable(service,name,preferred=""):
 if preferred and os.path.isfile(preferred) and os.access(preferred,os.X_OK): return preferred
 r=run(["systemctl","show",service,"-p","MainPID","--value"],5); pid=r.stdout.strip()
 if pid.isdigit() and pid!="0":
  try:
   value=os.path.realpath("/proc/"+pid+"/exe")
   if os.path.isfile(value): return value
  except OSError: pass
 return shutil.which(name) or ""
directory=tempfile.mkdtemp(prefix="wherever-connect-"); process=None
try:
 listener=socket.socket(); listener.bind(("127.0.0.1",0)); port=listener.getsockname()[1]; listener.close()
 if P["kind"]=="sing-box":
  binary=executable("sing-box.service","sing-box",P.get("preferredBinary",""))
  if not binary: raise RuntimeError("client-binary-not-found")
  outbound=P["outbound"]; outbound["tag"]="probe-out"
  config={"log":{"level":"error"},"inbounds":[{"type":"socks","tag":"probe-in","listen":"127.0.0.1","listen_port":port}],"outbounds":[outbound],"route":{"final":"probe-out"}}
  config_path=os.path.join(directory,"config.json")
  with open(config_path,"w",encoding="utf-8") as handle: json.dump(config,handle); os.fchmod(handle.fileno(),0o600)
  if run([binary,"check","-c",config_path],10).returncode!=0: raise RuntimeError("client-config-rejected")
  process=subprocess.Popen([binary,"run","-c",config_path],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 else:
  binary=executable("nowhere.service","nowhere",P.get("preferredBinary",""))
  if not binary: raise RuntimeError("client-binary-not-found")
  uri=urllib.parse.urlsplit(P["uri"]); query=dict(urllib.parse.parse_qsl(uri.query,keep_blank_values=True)); query["socks"]="127.0.0.1:"+str(port)
  vector=urllib.parse.urlunsplit((uri.scheme,uri.netloc,uri.path,urllib.parse.urlencode(query),uri.fragment))
  process=subprocess.Popen([binary,vector],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 ready=False
 for _ in range(50):
  if process.poll() is not None: raise RuntimeError("client-start-failed")
  probe=socket.socket(); probe.settimeout(.2)
  try: probe.connect(("127.0.0.1",port)); ready=True; break
  except OSError: time.sleep(.1)
  finally: probe.close()
 if not ready: raise RuntimeError("client-start-timeout")
 curl=run(["curl","--silent","--show-error","--fail","--max-time","25","--noproxy","","--proxy","socks5h://127.0.0.1:"+str(port),"https://www.cloudflare.com/cdn-cgi/trace"],30)
 if curl.returncode!=0: raise RuntimeError("proxy-https-failed")
 actual=next((line[3:].strip() for line in curl.stdout.splitlines() if line.startswith("ip=")),"")
 if not actual: raise RuntimeError("exit-ip-missing")
 expected=P.get("expectedIp","")
 version=run([binary,"version" if P["kind"]=="sing-box" else "--version"],5)
 emit({"ok":True,"https":True,"exitIpMatches":actual==expected if expected else None,"actualIp":actual[:64],"clientVersion":(version.stdout or version.stderr).splitlines()[0][:160]})
except subprocess.TimeoutExpired: emit({"ok":False,"error":"probe-timeout"})
except Exception as exc:
 error=str(exc)
 if error not in ("client-binary-not-found","client-config-rejected","client-start-failed","client-start-timeout","proxy-https-failed","exit-ip-missing"): error="probe-failed"
 emit({"ok":False,"error":error})
finally:
 if process is not None and process.poll() is None:
  process.terminate()
  try: process.wait(timeout=2)
  except subprocess.TimeoutExpired: process.kill(); process.wait()
 shutil.rmtree(directory,ignore_errors=True)
`;
  const code = Buffer.from(script, "utf8").toString("base64");
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return `python3 -c "$(printf '%s' '${code}' | base64 -d)" '${data}'`;
}

function parseConnectivityOutput(output) {
  const line = String(output || "").split(/\r?\n/).find(item => item.startsWith("PCCONNECT\t1\t"));
  if (!line) return { ok: false, error: "invalid-response" };
  try {
    const value = JSON.parse(Buffer.from(line.slice("PCCONNECT\t1\t".length), "base64").toString("utf8"));
    return value && typeof value === "object" ? value : { ok: false, error: "invalid-response" };
  } catch (_) { return { ok: false, error: "invalid-response" }; }
}

module.exports = { buildConnectivityCommand, parseConnectivityOutput };
