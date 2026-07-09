#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET = os.environ.get("GITHUB_WEBHOOK_SECRET", "").encode()
DEPLOY_REPO = os.environ.get("DEPLOY_REPO", "ritvik22/stemegle")
DEPLOY_BRANCH = os.environ.get("DEPLOY_BRANCH", "main")
DEPLOY_COMMAND = ["/usr/local/bin/stemegle-deploy"]
LOG_PATH = os.environ.get("DEPLOY_LOG", "/repo/deploy.log")
LOCK = threading.Lock()


def log(message):
    with open(LOG_PATH, "a", encoding="utf-8") as log_file:
        log_file.write(message.rstrip() + "\n")


def verify_signature(body, signature):
    if not SECRET or not signature or not signature.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(SECRET, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def deploy_after_response():
    if not LOCK.acquire(blocking=False):
        log("deploy skipped: another deploy is already running")
        return
    try:
        log("deploy started")
        result = subprocess.run(
            DEPLOY_COMMAND,
            cwd=os.environ.get("DEPLOY_DIR", "/repo"),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=900,
        )
        log(result.stdout)
        log(f"deploy exited with status {result.returncode}")
    except Exception as error:
        log(f"deploy failed: {error}")
    finally:
        LOCK.release()


class Handler(BaseHTTPRequestHandler):
    server_version = "StemegleWebhook/1.0"

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"ok\n")
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path != "/github":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        signature = self.headers.get("X-Hub-Signature-256", "")
        if not verify_signature(body, signature):
            self.send_response(401)
            self.end_headers()
            self.wfile.write(b"bad signature\n")
            return

        event = self.headers.get("X-GitHub-Event", "")
        try:
            payload = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"bad json\n")
            return

        if event == "ping":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"pong\n")
            return

        full_name = payload.get("repository", {}).get("full_name")
        ref = payload.get("ref")
        if event != "push" or full_name != DEPLOY_REPO or ref != f"refs/heads/{DEPLOY_BRANCH}":
            self.send_response(202)
            self.end_headers()
            self.wfile.write(b"ignored\n")
            return

        threading.Thread(target=deploy_after_response, daemon=True).start()
        self.send_response(202)
        self.end_headers()
        self.wfile.write(b"deploy queued\n")

    def log_message(self, fmt, *args):
        log("%s - %s" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    if not SECRET:
        raise SystemExit("GITHUB_WEBHOOK_SECRET is required")
    ThreadingHTTPServer(("0.0.0.0", 9000), Handler).serve_forever()
