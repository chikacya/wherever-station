import fcntl,hashlib,time
lock=None
try:
 if os.geteuid()!=0: stop("root-required")
 config_path=P["configPath"]; root=P["directory"]; unit=P["unitName"]; binary=P["binaryPath"]
 if os.path.realpath(config_path)!=config_path or not config_path.startswith(root+"/") or not os.path.isfile(binary): stop("managed-instance-missing")
 lock=open(config_path+".update-lock","a"); os.fchmod(lock.fileno(),0o600)
 try: fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError: stop("update-in-progress")
 with open(config_path,"rb") as handle: old=handle.read()
 if hashlib.sha256(old).hexdigest()!=P["expectedHash"]: stop("configuration-changed")
 candidate=base64.b64decode(P["configuration"],validate=True)
 if len(candidate)<2 or len(candidate)>262144: stop("configuration-size-invalid")
 json.loads(candidate.decode("utf-8"))
 next_path=config_path+".next"; rollback=config_path+".rollback"
 with open(next_path,"xb") as handle: handle.write(candidate); handle.flush(); os.fsync(handle.fileno()); os.fchmod(handle.fileno(),0o600)
 checked=run([binary,"check","-c",next_path],20)
 if checked.returncode!=0: os.unlink(next_path); stop("kernel-rejected")
 was_running=active(unit)=="active"
 with open(rollback,"wb") as handle: handle.write(old); handle.flush(); os.fsync(handle.fileno()); os.fchmod(handle.fileno(),0o600)
 os.replace(next_path,config_path)
 if was_running:
  restarted=run(["systemctl","restart",unit],20)
  time.sleep(1)
  if restarted.returncode!=0 or active(unit)!="active": raise RuntimeError("restart-failed")
 try: os.unlink(rollback)
 except OSError: pass
 emit({"ok":True,"state":active(unit),"configurationHash":hashlib.sha256(candidate).hexdigest()})
except subprocess.TimeoutExpired: error="timeout"
except (ValueError,UnicodeDecodeError,json.JSONDecodeError): error="configuration-invalid"
except Exception as exc: error=str(exc) if str(exc) in ("restart-failed",) else "update-failed"
finally:
 if "error" in locals():
  rolled_back=False
  try:
   if os.path.isfile(rollback):
    os.replace(rollback,config_path); rolled_back=True
    if "was_running" in locals() and was_running: run(["systemctl","restart",unit],20)
  except Exception: pass
  try:
   if os.path.isfile(next_path): os.unlink(next_path)
  except Exception: pass
  stop(error,rolledBack=rolled_back,state=active(P["unitName"]))
