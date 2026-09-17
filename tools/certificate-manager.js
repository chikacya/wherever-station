const crypto = require("node:crypto");
const { isIP } = require("node:net");
const path = require("node:path");

const CERTIFICATE_ROOT = "/var/lib/proxy-console/certificates";
const ACTIONS = new Set(["create", "inspect", "delete"]);

function text(value, label, max = 253) {
  const result = String(value == null ? "" : value).trim();
  if (!result || result.length > max || /[\0\r\n]/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}
function id(value) {
  const result = text(value, "certificate id", 64);
  if (!/^[a-z0-9][a-z0-9_-]{7,63}$/i.test(result)) throw new Error("Invalid certificate id");
  return result;
}
function absoluteFile(value, label) {
  const result = text(value, label, 512);
  if (!path.posix.isAbsolute(result) || result.split("/").includes("..")) throw new Error(`Invalid ${label}`);
  return result;
}
function host(value, label = "certificate subject") {
  const result = text(value, label).replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (isIP(result)) return result;
  if (result.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}
function uniqueSans(value, fallback) {
  const input = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  const result = [...new Set(input.map((item) => String(item || "").trim()).filter(Boolean).map((item) => host(item, "certificate SAN")))];
  if (!result.length && fallback) result.push(fallback);
  if (result.length > 32) throw new Error("Too many certificate SAN values");
  return result;
}
function planCertificateAsset(input = {}) {
  const certificateId = id(input.id);
  const mode = ["existing", "instance"].includes(input.mode) ? input.mode : "managed";
  const directory = path.posix.join(CERTIFICATE_ROOT, certificateId);
  const rawSubject = input.subjectName || input.certificateHost || input.publicHost;
  const subjectName = rawSubject ? host(rawSubject) : mode !== "managed" ? "" : host(rawSubject);
  const sans = uniqueSans(input.sans, subjectName);
  const days = Math.min(3650, Math.max(1, Number(input.days) || 825));
  const certificatePath = mode === "managed" ? path.posix.join(directory, "certificate.pem") : absoluteFile(input.certificatePath, "certificate path");
  const privateKeyPath = mode === "managed" ? path.posix.join(directory, "private-key.pem") : absoluteFile(input.privateKeyPath, "private key path");
  return { schema: 1, kind: "certificate", id: certificateId, mode, directory, certificatePath, privateKeyPath, subjectName, sans, days };
}
function shellCommand(script, payload) {
  const code = Buffer.from(script, "utf8").toString("base64");
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return `python3 -c "$(printf '%s' '${code}' | base64 -d)" '${data}'`;
}
function remoteScript() {
  return String.raw`import base64,datetime,hashlib,ipaddress,json,os,shutil,subprocess,sys
P=json.loads(base64.b64decode(sys.argv[1],validate=True).decode())
def emit(value): print("PCCERT\t1\t"+base64.b64encode(json.dumps(value,ensure_ascii=False,separators=(",",":")).encode()).decode())
def stop(error,**extra): emit({"ok":False,"error":error,**extra}); sys.exit(0)
def run(args,timeout=20,input_text=None): return subprocess.run(args,input=input_text,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=timeout,check=False)
def run_bytes(args,timeout=20,input_bytes=None): return subprocess.run(args,input=input_bytes,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,check=False)
def is_regular(filename):
 try: return os.path.isfile(filename) and not os.path.islink(filename)
 except OSError: return False
def openssl(args,timeout=20,input_text=None):
 result=run(["openssl",*args],timeout,input_text)
 if result.returncode!=0: stop("certificate-invalid")
 return result.stdout
def inspect_certificate():
 certificate=P["certificatePath"]; private_key=P["privateKeyPath"]
 if not is_regular(certificate) or not is_regular(private_key): stop("certificate-file-missing")
 cert_der=run_bytes(["openssl","x509","-in",certificate,"-outform","DER"],12)
 if cert_der.returncode!=0: stop("certificate-invalid")
 cert_public=openssl(["x509","-in",certificate,"-pubkey","-noout"],12)
 key_public=openssl(["pkey","-in",private_key,"-pubout"],12)
 cert_key_der=run_bytes(["openssl","pkey","-pubin","-outform","DER"],12,cert_public.encode())
 private_key_der=run_bytes(["openssl","pkey","-pubin","-outform","DER"],12,key_public.encode())
 if cert_key_der.returncode!=0 or private_key_der.returncode!=0: stop("certificate-invalid")
 key_match=hashlib.sha256(cert_key_der.stdout).digest()==hashlib.sha256(private_key_der.stdout).digest()
 if not key_match: stop("certificate-key-mismatch")
 details=openssl(["x509","-in",certificate,"-noout","-subject","-issuer","-serial","-startdate","-enddate"],12)
 san_result=run(["openssl","x509","-in",certificate,"-noout","-ext","subjectAltName"],12)
 if san_result.returncode==0: details += "\n"+san_result.stdout
 fields={}
 sans=[]
 for raw in details.splitlines():
  line=raw.strip()
  if line.startswith("subject="): fields["subject"]=line.split("=",1)[1].strip()
  elif line.startswith("issuer="): fields["issuer"]=line.split("=",1)[1].strip()
  elif line.startswith("serial="): fields["serialNumber"]=line.split("=",1)[1].strip()
  elif line.startswith("notBefore="): fields["validFrom"]=line.split("=",1)[1].strip()
  elif line.startswith("notAfter="): fields["expiresAt"]=line.split("=",1)[1].strip()
  elif "DNS:" in line or "IP Address:" in line:
   for item in line.split(","):
    item=item.strip()
    if item.startswith("DNS:"): sans.append(item[4:])
    elif item.startswith("IP Address:"): sans.append(item[11:])
 def iso(value):
  try: return datetime.datetime.strptime(value,"%b %d %H:%M:%S %Y %Z").replace(tzinfo=datetime.timezone.utc).isoformat().replace("+00:00","Z")
  except Exception: return ""
 fields["validFrom"]=iso(fields.get("validFrom","")); fields["expiresAt"]=iso(fields.get("expiresAt",""))
 now=datetime.datetime.now(datetime.timezone.utc); expires=datetime.datetime.fromisoformat(fields["expiresAt"].replace("Z","+00:00")) if fields["expiresAt"] else now
 remaining=(expires-now).total_seconds()
 status="expired" if remaining<=0 else "warning" if remaining<=30*86400 else "valid"
 cert_bytes=cert_der.stdout
 public_bytes=cert_key_der.stdout
 return {"ok":True,"mode":P["mode"],"certificatePath":certificate,"privateKeyPath":private_key,"status":status,"keyMatch":True,"fingerprintSha256":hashlib.sha256(cert_bytes).hexdigest(),"publicKeySha256":base64.b64encode(hashlib.sha256(public_bytes).digest()).decode(),"sans":sans,**fields,"checkedAt":now.isoformat().replace("+00:00","Z")}
if not shutil.which("openssl"): stop("openssl-not-found")
try:
 action=P["action"]
 if action=="create":
  if os.geteuid()!=0: stop("root-required")
  root=P["directory"]
  if not root.startswith("/var/lib/proxy-console/certificates/"): stop("certificate-path-invalid")
  if os.path.lexists(root): stop("certificate-exists")
  os.makedirs(root,mode=0o700); os.chmod(root,0o700)
  config=os.path.join(root,"openssl.cnf")
  san=[]
  for index,value in enumerate(P["sans"],1):
   try: ipaddress.ip_address(value); kind="IP"
   except ValueError: kind="DNS"
   san.append(f"{kind}.{index} = {value}")
  body="[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = ext\n[dn]\nCN = "+P["subjectName"]+"\n[ext]\nsubjectAltName = @alt\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\n[alt]\n"+"\n".join(san)+"\n"
  with open(config,"x",encoding="utf-8") as handle: handle.write(body); os.fchmod(handle.fileno(),0o600)
  result=run(["openssl","req","-x509","-newkey","rsa:2048","-nodes","-keyout",P["privateKeyPath"],"-out",P["certificatePath"],"-days",str(P["days"]),"-config",config],30)
  try: os.unlink(config)
  except OSError: pass
  if result.returncode!=0:
   shutil.rmtree(root,ignore_errors=True); stop("certificate-generation-failed")
  os.chmod(P["privateKeyPath"],0o600); os.chmod(P["certificatePath"],0o644)
  emit(inspect_certificate())
 elif action=="inspect": emit(inspect_certificate())
 elif action=="delete":
  if os.geteuid()!=0: stop("root-required")
  root=P["directory"]
  if P["mode"]!="managed" or not root.startswith("/var/lib/proxy-console/certificates/"): stop("certificate-delete-not-managed")
  if os.path.realpath(root)!=root or os.path.dirname(root)!="/var/lib/proxy-console/certificates": stop("certificate-path-invalid")
  if os.path.lexists(root): shutil.rmtree(root)
  emit({"ok":True,"deleted":True})
 else: stop("certificate-action-invalid")
except subprocess.TimeoutExpired: stop("timeout")
except Exception: stop("certificate-operation-failed")
`;
}
function buildCertificateCommand(action, input) {
  if (!ACTIONS.has(action)) throw new Error("Invalid certificate action");
  const plan = input && input.kind === "certificate" ? input : planCertificateAsset(input);
  return shellCommand(remoteScript(), { ...plan, action });
}
function parseCertificateOutput(output) {
  const prefix = "PCCERT\t1\t";
  const line = String(output || "").split(/\r?\n/).find((item) => item.startsWith(prefix));
  if (!line) return { ok: false, error: "invalid-response" };
  try { return JSON.parse(Buffer.from(line.slice(prefix.length), "base64").toString("utf8")); }
  catch (_) { return { ok: false, error: "invalid-response" }; }
}
function certificateId(seed = "") {
  return `cert-${crypto.createHash("sha256").update(String(seed || crypto.randomUUID())).digest("hex").slice(0, 18)}`;
}

module.exports = { ACTIONS, CERTIFICATE_ROOT, buildCertificateCommand, certificateId, parseCertificateOutput, planCertificateAsset };
