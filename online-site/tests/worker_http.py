"""Strict HTTP checks for the disposable local Worker, including proxy diagnostics."""

from html.parser import HTMLParser
from http.client import IncompleteRead, RemoteDisconnected
import json
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


TRANSPORT_ERRORS = (TimeoutError, URLError, ConnectionError, IncompleteRead, RemoteDisconnected)
SAFE_RESPONSE_HEADERS = ("Content-Type", "Content-Length", "Cache-Control", "WWW-Authenticate", "Retry-After")


def proxy_failure(status, headers, body):
    """Match local proxy failures, never an application's arbitrary HTTP 500."""
    if status == 500 and headers.get_content_type() == "text/plain" and body.startswith(b"Error: Network connection lost.\n") and b"node_modules/miniflare/dist/src/workers/core/entry.worker.js:" in body:
        return "miniflare_proxy_disconnect"
    if status == 503 and headers.get_content_type() == "text/plain" and b"worker restarted mid-request" in body:
        return "worker_restarted"
    return None


class WorkerHttpClient:
    def __init__(self, base, artifacts, *, opener=urlopen, sleep=time.sleep, attempts=5, emit=print):
        parsed = urlsplit(base)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
            raise ValueError("HTTP tests must use a disposable loopback Worker.")
        self.base = base.rstrip("/")
        self.artifacts = Path(artifacts)
        self.opener, self.sleep, self.attempts, self.emit = opener, sleep, attempts, emit
        self.history = []
        self.last = None
        self.startup_waits = 0

    def record(self, event, result=None):
        self.artifacts.mkdir(parents=True, exist_ok=True)
        number = len(self.history) + 1
        self.history.append(event)
        path = self.artifacts / f"http-{number:03d}.json"
        if result is not None:
            status, headers, body = result
            body_path = path.with_suffix(".body")
            body_path.write_bytes(body)
            event = {**event, "status": status, "headers": {key: headers[key] for key in SAFE_RESPONSE_HEADERS if headers.get(key) is not None}, "bytes": len(body), "body_file": str(body_path)}
        path.write_text(json.dumps(event, indent=2), encoding="utf-8")
        self.emit("HTTP_DIAGNOSTIC " + json.dumps({**event, "artifact": str(path)}))

    def request(self, path, method="GET", authorization=None, identity=False, origin=None, extra_headers=None, payload=None, *, attempts=None, timeout=20, startup_probe=False):
        if not path.startswith("/") or path.startswith("//") or urlsplit(path).netloc:
            raise ValueError("Use a relative Worker path.")
        headers = {"Content-Type": "application/json", **(extra_headers or {})}
        if authorization:
            headers["Authorization"] = authorization
        if identity:
            headers.update({"oai-authenticated-user-id": "local-auth-test", "oai-authenticated-user-email": "test@sites.test"})
        if origin:
            headers["Origin"] = origin
        body = json.dumps(payload or {}).encode() if method in ("POST", "PATCH", "DELETE", "PUT") else None
        request = Request(self.base + path, headers=headers, method=method, data=body)
        # Reuse the exact operation ID and serialized body; ordinary writes are
        # never retried because a disconnected response may already have committed.
        safe = method in ("GET", "HEAD") or (method == "POST" and path == "/api/commands" and isinstance(payload, dict) and isinstance(payload.get("id"), str) and bool(payload["id"]))
        limit = attempts if attempts is not None else self.attempts
        for attempt in range(1, limit + 1):
            try:
                try:
                    response = self.opener(request, timeout=timeout)
                except HTTPError as error:
                    response = error
                with response:
                    result = response.status, response.headers, response.read()
            except TRANSPORT_ERRORS as error:
                self.last = {"method": method, "path": path, "transport_error": type(error).__name__, "detail": str(error)[:300]}
                if startup_probe and method == "GET" and path == "/api/bootstrap" and isinstance(error, URLError) and isinstance(error.reason, ConnectionRefusedError):
                    # The process has not bound its socket yet; this is normal
                    # startup polling, not a failed application response.
                    self.startup_waits += 1
                    raise
                self.record({**self.last, "attempt": attempt, "retry": safe and attempt < limit})
                if not safe or attempt == limit:
                    raise
                self.sleep(.3)
                continue
            self.last = {"method": method, "path": path, "result": result}
            reason = proxy_failure(*result)
            if reason:
                self.record({"method": method, "path": path, "attempt": attempt, "reason": reason, "retry": safe and attempt < limit}, result)
                if safe and attempt < limit:
                    self.sleep(.3)
                    continue
            return result
        raise ValueError("HTTP attempts must be greater than zero.")

    def save_failure(self):
        if self.last:
            self.record({"method": self.last["method"], "path": self.last["path"], "reason": "test_failure", "transport_error": self.last.get("transport_error")}, self.last.get("result"))


class LoginPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_login = False
        self.login_form = False
        self.fields = {}
        self.in_title = False
        self.title = ""
        self.html_closed = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "form":
            self.in_login = attrs.get("id") == "accountLoginForm"
            self.login_form |= self.in_login
        if tag == "input" and self.in_login:
            self.fields[attrs.get("name")] = attrs.get("type", "text")
        if tag == "title":
            self.in_title = True

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == "form":
            self.in_login = False
        if tag == "title":
            self.in_title = False
        if tag == "html":
            self.html_closed = True

    def handle_data(self, data):
        if self.in_title:
            self.title += data


def assert_login_page(result):
    status, headers, body = result
    info = {"path": "/", "status": status, "content_type": headers.get_content_type(), "bytes": len(body), "body_prefix": body[:300].decode("utf-8", errors="replace")}
    assert status == 200, info
    assert headers.get_content_type() == "text/html", info
    assert "no-store" in headers.get("Cache-Control", ""), info
    assert not headers.get("WWW-Authenticate"), info
    page = LoginPage()
    page.feed(body.decode("utf-8"))
    page.close()
    assert page.html_closed and page.login_form and "username" in page.fields and page.fields.get("password") == "password" and "Arafat Traders" in page.title, {**info, "form": page.login_form, "fields": page.fields, "title": page.title, "complete_html": page.html_closed}


def wait_for_worker(client, process, timeout=30):
    """Readiness requires both the protected API and the actual rendered page."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Local Worker exited before readiness.")
        try:
            result = client.request("/api/bootstrap", attempts=1, startup_probe=True, timeout=min(3, max(.1, deadline-time.monotonic())))
            if proxy_failure(*result):
                client.sleep(.1)
                continue
            assert result[0] == 401, ("Unexpected readiness API response", result[0], result[2][:300])
            result = client.request("/", attempts=1, timeout=min(3, max(.1, deadline-time.monotonic())))
            if not proxy_failure(*result):
                assert_login_page(result)
                return
        except TRANSPORT_ERRORS:
            pass
        client.sleep(.1)
    raise RuntimeError(f"Local Worker not ready within {timeout}s; see {client.artifacts}")
