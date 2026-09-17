const { planManagedSingBox } = require("./managed-sing-box");

const ACTIONS = new Set(["create", "start", "stop", "restart", "status", "logs", "delete", "read-config", "update"]);
function command(script, payload) {
  const code = Buffer.from(script.replace(/\n\+/g, "\n"), "utf8").toString("base64");
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return `python3 -c "$(printf '%s' '${code}' | base64 -d)" '${data}'`;
}
function base() {
  return `import base64,datetime,hashlib,json,os,shutil,subprocess,sys\nP=json.loads(base64.b64decode(sys.argv[1],validate=True).decode())\ndef emit(value): print("PCSINGBOX\\t1\\t"+base64.b64encode(json.dumps(value,ensure_ascii=False,separators=(",",":")).encode()).decode())\ndef run(args,timeout=20): return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout,check=False)\ndef active(unit):\n r=run(["systemctl","is-active",unit],5); return r.stdout.strip() or "unknown"\ndef certificate_metadata(filename):\n if not os.path.isfile(filename) or not shutil.which("openssl"): return None\n der=subprocess.run(["openssl","x509","-in",filename,"-outform","DER"],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=12,check=False)\n public=run(["openssl","x509","-in",filename,"-pubkey","-noout"],12)\n spki=subprocess.run(["openssl","pkey","-pubin","-outform","DER"],input=public.stdout.encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=12,check=False)\n dates=run(["openssl","x509","-in",filename,"-noout","-enddate"],12).stdout.strip().removeprefix("notAfter=")\n try: expires=datetime.datetime.strptime(dates,"%b %d %H:%M:%S %Y %Z").replace(tzinfo=datetime.timezone.utc).isoformat().replace("+00:00","Z")\n except Exception: expires=""\n if der.returncode!=0 or spki.returncode!=0: return None\n return {"fingerprintSha256":hashlib.sha256(der.stdout).hexdigest(),"publicKeySha256":base64.b64encode(hashlib.sha256(spki.stdout).digest()).decode(),"expiresAt":expires}\ndef stop(error,**extra): emit({"ok":False,"error":error,**extra}); sys.exit(0)\n`;
}
function lockExistingInstance(script) {
  const locking = `import fcntl\ninstance_lock=None\nif os.path.isdir(P["directory"]):\n if os.geteuid()!=0: stop("root-required")\n instance_lock=open(P["configPath"]+".update-lock","a")\n os.fchmod(instance_lock.fileno(),0o600)\n try: fcntl.flock(instance_lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)\n except BlockingIOError: stop("update-in-progress")\n`;
  return script.replace(base(), base() + locking);
}
function createScript() {
  return base() + `created_root=False; created_unit=False\n+try:\n+ if os.geteuid()!=0: stop("root-required")\n+ root=P["directory"]; unit_path=P["unitPath"]; binary=P["binaryPath"]; config_path=P["configPath"]; port=str(P["port"])\n+ if os.path.exists(root): stop("instance-exists")\n+ if os.path.exists(unit_path): stop("unit-exists")\n+ output=run(["ss","-H","-lntup"],8).stdout if shutil.which("ss") else ""\n+ if any(len(line.split())>4 and line.split()[4].rsplit(":",1)[-1]==port for line in output.splitlines()): stop("port-in-use")\n+ pid=run(["systemctl","show","sing-box.service","-p","MainPID","--value"],5).stdout.strip(); source=""\n+ if pid.isdigit() and pid!="0":\n+  try: source=os.path.realpath("/proc/"+pid+"/exe")\n+  except OSError: source=""\n+ if not source or not os.path.isfile(source): source=shutil.which("sing-box") or ""\n+ if not source or not os.path.isfile(source): stop("binary-not-found")\n+ os.makedirs(root,mode=0o700); os.chmod(root,0o700); os.makedirs(os.path.dirname(binary),mode=0o700); os.chmod(os.path.dirname(binary),0o700); created_root=True\n+ shutil.copy2(source,binary); os.chmod(binary,0o755)\n+ with open(config_path,"x",encoding="utf-8") as handle: handle.write(P["config"]); os.fchmod(handle.fileno(),0o600)\n+ checked=run([binary,"check","-c",config_path],20)\n+ if checked.returncode!=0: raise RuntimeError("kernel-rejected")\n+ with open(unit_path,"x",encoding="utf-8") as handle: handle.write(P["unit"]); os.fchmod(handle.fileno(),0o644); created_unit=True\n+ if run(["systemctl","daemon-reload"],15).returncode!=0: raise RuntimeError("daemon-reload-failed")\n+ version=run([binary,"version"],5).stdout.splitlines()[0][:160]\n+ emit({"ok":True,"state":"stopped","created":True,"kernelValid":True,"binaryVersion":version,"existingSingBox":active("sing-box.service"),"existingNowhere":active("nowhere.service")})\n+except subprocess.TimeoutExpired: error="timeout"\n+except Exception as exc: error=str(exc) if str(exc) in ("kernel-rejected","daemon-reload-failed") else "create-failed"\n+finally:\n+ if "error" in locals():\n+  if created_unit:\n+   try: os.unlink(P["unitPath"])\n+   except OSError: pass\n+  if created_root: shutil.rmtree(P["directory"],ignore_errors=True)\n+  try: run(["systemctl","daemon-reload"],15)\n+  except Exception: pass\n+  stop(error,cleaned=True)`;
}
function actionScript(action) {
  return base() + `try:\n+ unit=P["unitName"]\n+ if os.geteuid()!=0: stop("root-required")\n+ if not os.path.isfile(P["unitPath"]) or not os.path.isdir(P["directory"]): stop("managed-instance-missing")\n+ result=run(["systemctl",${JSON.stringify(action)},unit],20)\n+ if result.returncode!=0: stop("service-action-failed",state=active(unit))\n+ emit({"ok":True,"state":active(unit),"existingSingBox":active("sing-box.service"),"existingNowhere":active("nowhere.service")})\n+except subprocess.TimeoutExpired: stop("timeout")\n+except Exception: stop("service-action-failed")`;
}
function statusScript(logs) {
  return base() + `try:\n+ unit=P["unitName"]; state=active(unit); result={"ok":True,"state":state,"installed":os.path.isfile(P["unitPath"]) and os.path.isdir(P["directory"]),"existingSingBox":active("sing-box.service"),"existingNowhere":active("nowhere.service")}\n+ ${logs ? 'journal=run(["journalctl","-u",unit,"-n","80","--no-pager","--output=short-iso"],10); result["logs"]=(journal.stdout or journal.stderr)[-24000:]' : ''}\n+ emit(result)\n+except Exception: stop("status-failed")`;
}
function deleteScript() {
  return base() + `try:\n+ unit=P["unitName"]; state=active(unit)\n+ if state in ("active","activating","deactivating"): stop("stop-before-delete",state=state)\n+ if not os.path.isfile(P["unitPath"]) or not os.path.isdir(P["directory"]): stop("managed-instance-missing")\n+ os.unlink(P["unitPath"]); shutil.rmtree(P["directory"])\n+ if run(["systemctl","daemon-reload"],15).returncode!=0: stop("daemon-reload-failed")\n+ emit({"ok":True,"state":"deleted","existingSingBox":active("sing-box.service"),"existingNowhere":active("nowhere.service")})\n+except Exception: stop("delete-failed")`;
}
function buildManagedSingBoxCommand(action, input, sourceMode = "copy", version = "1.13.11") {
  if (!ACTIONS.has(action)) throw new Error("Invalid managed sing-box action");
  const plan = input && input.kind === "managed-sing-box" ? input : planManagedSingBox(input);
  const payload = { id: plan.id, directory: plan.directory, binaryPath: plan.binaryPath, configPath: plan.configPath, unitName: plan.unitName, unitPath: plan.unitPath, port: plan.summary.port, serverName: plan.summary.serverName || "", certificateSubjectType: require("node:net").isIP(plan.summary.serverName || "") ? "IP" : "DNS" };
  if (action === "create") {
    if (!["copy", "download"].includes(sourceMode)) throw new Error("Invalid binary source");
    if (!/^1\.\d{1,3}\.\d{1,3}$/.test(version)) throw new Error("请选择有效的 sing-box 正式版本");
    let script = createScript();
    if (plan.selfSigned) {
      const generate = 'if not shutil.which("openssl"): raise RuntimeError("openssl-not-found")\n+ certificate=run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-keyout",os.path.join(root,"server.key"),"-out",os.path.join(root,"server.crt"),"-days","365","-subj","/CN="+P["serverName"],"-addext","subjectAltName="+P["certificateSubjectType"]+":"+P["serverName"]],30)\n+ if certificate.returncode!=0: raise RuntimeError("certificate-generation-failed")\n+ os.chmod(os.path.join(root,"server.key"),0o600)\n+ ';
      script = script.replace('("kernel-rejected","daemon-reload-failed")', '("kernel-rejected","daemon-reload-failed","openssl-not-found","certificate-generation-failed")');
      script = script.replace('with open(config_path,"x",encoding="utf-8")', generate + 'with open(config_path,"x",encoding="utf-8")');
      script = script.replace(
        'emit({"ok":True,"state":"stopped","created":True,"kernelValid":True,"binaryVersion":version,"existingSingBox":active("sing-box.service"),"existingNowhere":active("nowhere.service")})',
        'metadata=certificate_metadata(os.path.join(root,"server.crt"))\n+ emit({"ok":True,"state":"stopped","created":True,"kernelValid":True,"binaryVersion":version,"existingSingBox":active("sing-box.service"),"existingNowhere":active("nowhere.service"),**({"certificate":metadata} if metadata else {})})',
      );
    }
    if (sourceMode === "download") {
      const helper = require("fs").readFileSync(require("path").join(__dirname, "download-sing-box.py"), "utf8");
      script = script.replace('created_root=False; created_unit=False', helper + '\ncreated_root=False; created_unit=False');
      const start = script.indexOf('+ pid=run(');
      const end = script.indexOf('+ os.makedirs(root', start);
      script = script.slice(0, start) + script.slice(end);
      script = script.replace('shutil.copy2(source,binary); os.chmod(binary,0o755)', 'install_release(binary,P["version"])');
    }
    return command(script, { ...payload, config: plan.config, unit: plan.unit, version });
  }
  if (action === "read-config") {
    const script = require("fs").readFileSync(require("path").join(__dirname, "sing-box-read.py"), "utf8");
    return command(lockExistingInstance(base() + script), payload);
  }
  if (action === "update") {
    if (!/^[a-f0-9]{64}$/.test(String(input.expectedHash || ""))) throw new Error("Current configuration hash required");
    const script = require("fs").readFileSync(require("path").join(__dirname, "sing-box-update.py"), "utf8");
    return command(base() + script, { ...payload, configuration: Buffer.from(plan.config).toString("base64"), expectedHash: input.expectedHash });
  }
  if (["start", "stop", "restart"].includes(action)) return command(lockExistingInstance(actionScript(action)), payload);
  if (action === "status" || action === "logs") return command(statusScript(action === "logs"), payload);
  return command(lockExistingInstance(deleteScript()), payload);
}
module.exports = { ACTIONS, buildManagedSingBoxCommand };
