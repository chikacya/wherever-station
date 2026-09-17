import json
import shutil
import time

transaction_file = P["environmentPath"] + ".transaction"
rollback_file = P["environmentPath"] + ".rollback"
if os.path.isfile(transaction_file):
    try:
        with open(transaction_file, "r", encoding="utf-8") as handle:
            interrupted = json.load(handle)
        schema = interrupted.get("schema")
        if schema == 1:
            if not os.path.isfile(rollback_file):
                stop("recovery-failed")
            os.replace(rollback_file, P["environmentPath"])
        elif schema in (2, 3):
            restore_directory = os.path.realpath(str(interrupted.get("restoreDirectory") or ""))
            instance_root = os.path.realpath(P["directory"])
            restore_binary = os.path.join(restore_directory, "nowhere")
            restore_environment = os.path.join(restore_directory, "nowhere.env")
            if not restore_directory.startswith(instance_root + os.sep) or not os.path.isfile(restore_binary) or not os.path.isfile(restore_environment):
                stop("recovery-failed")
            run(["systemctl", "stop", P["unitName"]], 25)
            shutil.copy2(restore_binary, P["binaryPath"] + ".recover")
            os.chmod(P["binaryPath"] + ".recover", 0o755)
            os.replace(P["binaryPath"] + ".recover", P["binaryPath"])
            shutil.copy2(restore_environment, P["environmentPath"] + ".recover")
            os.chmod(P["environmentPath"] + ".recover", 0o600)
            os.replace(P["environmentPath"] + ".recover", P["environmentPath"])
        else:
            stop("recovery-failed")
        if interrupted.get("wasRunning"):
            recovered = run(["systemctl", "restart", P["unitName"]], 25)
            time.sleep(1)
            if recovered.returncode != 0 or active(P["unitName"]) != "active":
                stop("recovery-failed")
        else:
            recovered = run(["systemctl", "stop", P["unitName"]], 25)
            if recovered.returncode != 0 or active(P["unitName"]) == "active":
                stop("recovery-failed")
        os.unlink(transaction_file)
    except (OSError, ValueError, json.JSONDecodeError):
        stop("recovery-failed")
