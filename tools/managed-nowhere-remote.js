const fs = require("node:fs");
const path = require("node:path");
const { cleanInstanceId, planManagedNowhere } = require("./managed-nowhere");
const { nowhereCapabilities } = require("./nowhere-capabilities");

const ACTIONS = new Set(["preflight", "create", "start", "stop", "restart", "status", "logs", "delete", "upgrade", "migrate-v2", "rollback-v1", "update", "read-config"]);

function encodedCommand(script, payload) {
  const code = Buffer.from(script, "utf8").toString("base64");
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return `python3 -c "$(printf '%s' '${code}' | base64 -d)" '${data}'`;
}

function commonPython() {
  return `import base64,json,os,subprocess,sys\nP=json.loads(base64.b64decode(sys.argv[1],validate=True).decode())\ndef emit(value): print("PCNOWHERE\\t2\\t"+base64.b64encode(json.dumps(value,ensure_ascii=False,separators=(",",":")).encode()).decode())\ndef run(args,timeout=15): return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout,check=False)\ndef active(unit):\n r=run(["systemctl","is-active",unit],5); return r.stdout.strip() or "unknown"\ndef stop(error,**extra): emit({"ok":False,"error":error,**extra}); sys.exit(0)\n`;
}

function scriptFile(name) {
  return fs.readFileSync(path.join(__dirname, name), "utf8");
}

function lockExistingInstance(script) {
  const locking = `import fcntl\ninstance_lock=None\nif os.path.isdir(P["directory"]):\n if os.geteuid()!=0: stop("root-required")\n instance_lock=open(P["environmentPath"]+".update-lock","a")\n os.fchmod(instance_lock.fileno(),0o600)\n try: fcntl.flock(instance_lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)\n except BlockingIOError: stop("update-in-progress")\n`;
  return commonPython() + locking + scriptFile("nowhere-recover.py") + "\n" + script;
}

function payloadFor(plan) {
  const ports = [
    plan.summary.tcpPort ? { transport: "tcp", port: plan.summary.tcpPort } : null,
    plan.summary.udpPort ? { transport: "udp", port: plan.summary.udpPort } : null,
  ].filter(Boolean);
  return {
    id: cleanInstanceId(plan.id),
    directory: plan.directory,
    binaryPath: plan.binaryPath,
    environmentPath: plan.environmentPath,
    unitName: plan.unitName,
    unitPath: plan.unitPath,
    port: plan.summary.port,
    tcpPort: plan.summary.tcpPort,
    udpPort: plan.summary.udpPort,
    ports,
    network: plan.summary.network,
    version: plan.version,
    certificateMode: plan.certificateMode,
    certificatePath: plan.certificatePath,
    privateKeyPath: plan.privateKeyPath,
    certificateHost: plan.certificateHost,
    certificateDays: plan.certificateDays,
  };
}

function buildManagedNowhereCommand(action, input, sourceMode = "download") {
  if (!ACTIONS.has(action)) throw new Error("Invalid managed Nowhere action");
  const plan = input && input.kind === "managed-nowhere" ? input : planManagedNowhere(input);
  const planCapabilities = nowhereCapabilities(plan.version);
  if (["create", "update"].includes(action) && !planCapabilities.verified) throw new Error("Unverified Nowhere version is read-only");
  const payload = payloadFor(plan);
  if (action === "preflight") return encodedCommand(commonPython() + scriptFile("nowhere-preflight.py"), payload);
  if (action === "read-config") return encodedCommand(lockExistingInstance(scriptFile("nowhere-read.py")), payload);
  if (action === "update") {
    if (!/^[a-f0-9]{64}$/.test(String(input.expectedHash || ""))) throw new Error("Current configuration hash required");
    return encodedCommand(commonPython() + scriptFile("nowhere-update.py"), {
      ...payload,
      environment: plan.environment,
      expectedHash: input.expectedHash,
    });
  }
  if (action === "create") {
    return encodedCommand(commonPython() + scriptFile("nowhere-create.py"), {
      ...payload,
      environment: plan.environment,
      unit: plan.unit,
      sourceMode,
    });
  }
  if (action === "upgrade") {
    const targetVersion = String(input.targetVersion || "");
    if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(targetVersion)) throw new Error("Invalid target Nowhere version");
    const current = nowhereCapabilities(plan.version);
    const target = nowhereCapabilities(targetVersion);
    if (!current.verified || !target.verified || current.protocolGeneration !== target.protocolGeneration) throw new Error("Nowhere major-version migration required or version is unverified");
    return encodedCommand(lockExistingInstance(scriptFile("nowhere-binary-upgrade.py")), { ...payload, targetVersion });
  }
  if (action === "migrate-v2") {
    const previousVersion = String(input.previousVersion || "");
    const current = nowhereCapabilities(previousVersion);
    const target = nowhereCapabilities(plan.version);
    if (!current.verified || !target.verified || current.protocolGeneration !== 1 || target.protocolGeneration !== 2) throw new Error("Invalid or unverified Nowhere V1 to V2 migration");
    return encodedCommand(lockExistingInstance(scriptFile("nowhere-migrate-v2.py")), {
      ...payload, previousVersion, targetVersion: plan.version, environment: plan.environment,
    });
  }
  if (action === "rollback-v1") {
    if (!input.backupDirectory) throw new Error("Nowhere migration backup required");
    return encodedCommand(lockExistingInstance(scriptFile("nowhere-rollback-v1.py")), {
      ...payload, backupDirectory: input.backupDirectory,
    });
  }
  if (["start", "stop", "restart"].includes(action)) {
    return encodedCommand(lockExistingInstance(scriptFile("nowhere-action.py")), { ...payload, action });
  }
  if (action === "status" || action === "logs") {
    return encodedCommand(commonPython() + scriptFile("nowhere-status.py"), { ...payload, includeLogs: action === "logs" });
  }
  return encodedCommand(lockExistingInstance(scriptFile("nowhere-delete.py")), payload);
}

function parseManagedNowhereOutput(output) {
  const line = String(output || "").split(/\r?\n/).find((item) => item.startsWith("PCNOWHERE\t2\t"));
  if (!line) return { ok: false, error: "invalid-response" };
  try {
    const value = JSON.parse(Buffer.from(line.slice("PCNOWHERE\t2\t".length), "base64").toString("utf8"));
    return value && typeof value === "object" ? value : { ok: false, error: "invalid-response" };
  } catch (_) {
    return { ok: false, error: "invalid-response" };
  }
}

module.exports = { ACTIONS, buildManagedNowhereCommand, parseManagedNowhereOutput };
