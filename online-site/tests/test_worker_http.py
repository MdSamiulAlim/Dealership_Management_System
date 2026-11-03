"""Regression tests: handle local proxy disconnects without hiding app failures."""

from email.message import Message
from http.client import IncompleteRead, RemoteDisconnected
from io import BytesIO
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from urllib.error import URLError

from worker_http import WorkerHttpClient, assert_login_page, wait_for_worker


PROXY_LOST = b"Error: Network connection lost.\n    at async Object.fetch (file:///fixture/node_modules/miniflare/dist/src/workers/core/entry.worker.js:4672:22)"
SHELL = b'<html><head><title>Arafat Traders</title></head><body><form id="accountLoginForm"><input name="username"/><input type="password" name="password"/></form></body></html>'


class Response(BytesIO):
    def __init__(self, body=SHELL, status=200, content_type="text/html"):
        super().__init__(body)
        self.status = status
        self.headers = Message()
        self.headers["Content-Type"] = content_type
        self.headers["Cache-Control"] = "private, no-store"


class WorkerHttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.opener = Mock()
        self.sleep = Mock()
        self.client = WorkerHttpClient("http://127.0.0.1:12345", self.directory.name, opener=self.opener, sleep=self.sleep, emit=lambda _: None)

    def test_observed_first_ssr_proxy_disconnect_is_recorded_then_recovers(self):
        self.opener.side_effect = [Response(PROXY_LOST, 500, "text/plain"), Response()]
        assert_login_page(self.client.request("/"))
        self.assertEqual(self.opener.call_count, 2)
        self.assertEqual(self.client.history[0]["reason"], "miniflare_proxy_disconnect")
        artifact = json.loads(next(Path(self.directory.name).glob("*.json")).read_text())
        self.assertEqual(Path(artifact["body_file"]).read_bytes(), PROXY_LOST)
        self.assertNotIn("Set-Cookie", artifact["headers"])

    def test_actual_application_500_is_not_retried_or_hidden(self):
        for body, content_type in [(b"Application render failed", "text/plain"), (b'{"error":"Network connection lost."}', "application/json"), (b"Error: Network connection lost.\n    at app/page.tsx:1:1", "text/plain")]:
            with self.subTest(body=body):
                self.opener.reset_mock()
                self.opener.side_effect = [Response(body, 500, content_type), Response()]
                with self.assertRaisesRegex(AssertionError, "500"):
                    assert_login_page(self.client.request("/"))
                self.assertEqual(self.opener.call_count, 1)

    def test_auth_failures_and_other_http_errors_are_not_retried(self):
        for status in [400, 401, 403, 404, 429, 503]:
            with self.subTest(status=status):
                self.opener.reset_mock()
                self.opener.side_effect = [Response(b"Rejected", status, "text/plain"), Response()]
                self.assertEqual(self.client.request("/api/bootstrap")[0], status)
                self.assertEqual(self.opener.call_count, 1)

    def test_missing_form_serialized_form_or_truncated_200_fails_without_retry(self):
        for body in [b"<html><head><title>Arafat Traders</title></head><body>accountLoginForm</body></html>", b'<html><head><title>Arafat Traders</title></head><body><script>"<form id=accountLoginForm>"</script></body></html>', SHELL.replace(b'</html>', b''), SHELL.replace(b'name="password"', b'name="other"')]:
            with self.subTest(body=body):
                self.opener.reset_mock()
                self.opener.side_effect = [Response(body), Response()]
                with self.assertRaises(AssertionError):
                    assert_login_page(self.client.request("/"))
                self.assertEqual(self.opener.call_count, 1)

    def test_wrong_type_or_browser_basic_challenge_fails_shell_check(self):
        for content_type, challenge in [("text/plain", False), ("text/html", True)]:
            r = Response(content_type=content_type)
            if challenge:
                r.headers["WWW-Authenticate"] = 'Basic realm="unexpected"'
            with self.assertRaises(AssertionError):
                assert_login_page((r.status, r.headers, r.read()))

    def test_proxy_retries_are_bounded_and_persistent_failure_fails(self):
        self.opener.side_effect = [Response(PROXY_LOST, 500, "text/plain") for _ in range(5)]
        with self.assertRaises(AssertionError):
            assert_login_page(self.client.request("/"))
        self.assertEqual(self.opener.call_count, 5)
        self.assertEqual(self.sleep.call_count, 4)
        self.assertFalse(self.client.history[-1]["retry"])

    def test_ordinary_writes_never_retry_after_ambiguous_network_failure(self):
        for path in ["/api/sales", "/api/customers", "/api/login"]:
            with self.subTest(path=path):
                self.opener.reset_mock()
                self.opener.side_effect = [RemoteDisconnected("response lost"), Response()]
                with self.assertRaises(RemoteDisconnected):
                    self.client.request(path, "POST", payload={"amount": 10})
                self.assertEqual(self.opener.call_count, 1)

    def test_restart_responses_do_not_retry_ordinary_writes(self):
        self.opener.side_effect = [Response(b"worker restarted mid-request", 503, "text/plain"), Response()]
        self.assertEqual(self.client.request("/api/sales", "POST", payload={"quantity": 1})[0], 503)
        self.assertEqual(self.opener.call_count, 1)

    def test_idempotent_commands_reuse_the_exact_request_body_and_operation_id(self):
        self.opener.side_effect = [RemoteDisconnected("response lost"), Response(b'{}', content_type="application/json")]
        payload = {"id": "same-command-id", "method": "POST", "path": "/api/payments", "payload": {"amount": 10}}
        self.client.request("/api/commands", "POST", payload=payload)
        first, second = [call.args[0] for call in self.opener.call_args_list]
        self.assertIs(first, second)
        self.assertEqual(json.loads(first.data), payload)

    def test_command_without_operation_id_is_not_retried(self):
        self.opener.side_effect = [URLError("lost"), Response()]
        with self.assertRaises(URLError):
            self.client.request("/api/commands", "POST", payload={"method": "POST"})
        self.assertEqual(self.opener.call_count, 1)

    def test_disconnect_while_reading_a_safe_response_is_retried(self):
        partial = Response()
        partial.read = Mock(side_effect=IncompleteRead(b"partial body"))
        self.opener.side_effect = [partial, Response()]
        assert_login_page(self.client.request("/"))
        self.assertEqual(self.opener.call_count, 2)

    def test_api_401_alone_is_not_readiness_and_page_500_fails_immediately(self):
        self.opener.side_effect = [Response(b'{}', 401, "application/json"), Response(b"Broken render", 500)]
        with self.assertRaises(AssertionError):
            wait_for_worker(self.client, Mock(poll=lambda: None))
        self.assertEqual([call.args[0].full_url for call in self.opener.call_args_list], ["http://127.0.0.1:12345/api/bootstrap", "http://127.0.0.1:12345/"])

    def test_readiness_handles_known_first_page_disconnect_and_checks_both_routes(self):
        self.opener.side_effect = [Response(b'{}', 401, "application/json"), Response(PROXY_LOST, 500, "text/plain"), Response(b'{}', 401, "application/json"), Response()]
        wait_for_worker(self.client, Mock(poll=lambda: None))
        self.assertEqual(self.opener.call_count, 4)
        self.assertEqual(self.client.history[0]["reason"], "miniflare_proxy_disconnect")

    def test_waiting_for_initial_socket_bind_is_not_an_application_failure(self):
        self.opener.side_effect = [URLError(ConnectionRefusedError("not bound yet")), Response(b'{}', 401, "application/json"), Response()]
        wait_for_worker(self.client, Mock(poll=lambda: None))
        self.assertEqual(self.client.startup_waits, 1)
        self.assertEqual(self.client.history, [])

    def test_startup_has_a_deadline_and_a_dead_worker_fails(self):
        with patch("worker_http.time.monotonic", side_effect=[0, 31]):
            with self.assertRaisesRegex(RuntimeError, "not ready"):
                wait_for_worker(self.client, Mock(poll=lambda: None))
        with self.assertRaisesRegex(RuntimeError, "exited"):
            wait_for_worker(self.client, Mock(poll=lambda: 1))
        self.assertEqual(self.opener.call_count, 0)

    def test_failure_diagnostics_include_status_headers_and_original_response(self):
        self.opener.side_effect = [Response(b"broken", 500, "text/plain")]
        self.client.request("/")
        self.client.save_failure()
        artifact = json.loads(next(Path(self.directory.name).glob("*.json")).read_text())
        self.assertEqual(artifact["status"], 500)
        self.assertEqual(artifact["path"], "/")
        self.assertEqual(Path(artifact["body_file"]).read_bytes(), b"broken")

    def test_http_harness_is_restricted_to_the_disposable_loopback_worker(self):
        with self.assertRaises(ValueError):
            WorkerHttpClient("https://app.example", self.directory.name)
        with self.assertRaises(ValueError):
            self.client.request("//app.example/")


if __name__ == "__main__":
    unittest.main()
