try:
 config_path=P["configPath"]
 if os.geteuid()!=0: stop("root-required")
 if os.path.realpath(config_path)!=config_path or not config_path.startswith(P["directory"]+"/"): stop("managed-instance-missing")
 stat=os.stat(config_path)
 if stat.st_size<2 or stat.st_size>262144: stop("configuration-size-invalid")
 with open(config_path,"rb") as handle: raw=handle.read()
 configuration=json.loads(raw.decode("utf-8"))
 if not isinstance(configuration,dict): stop("configuration-invalid")
 emit({"ok":True,"configuration":base64.b64encode(raw).decode(),"configurationHash":__import__("hashlib").sha256(raw).hexdigest(),"state":active(P["unitName"])})
except (OSError,UnicodeDecodeError,json.JSONDecodeError): stop("configuration-invalid")
except Exception: stop("read-config-failed")
