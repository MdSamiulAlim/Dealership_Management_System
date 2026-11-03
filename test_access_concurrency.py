"""Deterministic thread interleavings for the local Python login limiter."""
import base64
from concurrent.futures import ThreadPoolExecutor, wait
import threading
import unittest
from unittest.mock import patch
from access import AccessControl, password_record

class LoginConcurrencyTests(unittest.TestCase):
    def test_only_ten_concurrent_guesses_are_admitted_before_hashing(self):
        control = AccessControl(password_record('owner', 'test-only-password-42'))
        start = threading.Barrier(40)
        hashing = threading.Condition()
        release = threading.Event()
        calls = 0
        def slow_hash(*args):
            nonlocal calls
            with hashing:
                calls += 1
                hashing.notify_all()
            if not release.wait(5):
                raise AssertionError('test hash gate timed out')
            return bytes(32)
        def attempt():
            start.wait(5)
            return control.verify('Basic '+base64.b64encode(b'owner:wrong').decode(), 'same-client')
        with patch('access.hashlib.pbkdf2_hmac', side_effect=slow_hash), ThreadPoolExecutor(max_workers=40) as pool:
            jobs = [pool.submit(attempt) for _ in range(40)]
            try:
                with hashing:
                    self.assertTrue(hashing.wait_for(lambda: calls >= 10, timeout=5))
                completed, _ = wait(jobs, timeout=.5)
                self.assertEqual(len(completed), 30)
                self.assertTrue(all(job.result() == 429 for job in completed))
            finally:
                release.set()
            results = [job.result() for job in jobs]
        self.assertEqual(calls, 10)
        self.assertEqual(results.count(401), 10)
        self.assertEqual(results.count(429), 30)
        self.assertEqual(control.failures['same-client'][1], 10)

    def test_anonymous_challenges_do_not_consume_or_reset_failed_attempts(self):
        control = AccessControl(password_record('owner', 'test-only-password-42'))
        with patch('access.time.monotonic', return_value=100):
            control.failures['same-client'] = (100, 10)
            self.assertEqual(control.verify('', 'same-client'), 401)
            self.assertEqual(control.failures['same-client'][1], 10)
            self.assertEqual(control.verify('Basic !!!', 'same-client'), 429)
        with patch('access.time.monotonic', return_value=161):
            self.assertEqual(control.verify('Basic !!!', 'same-client'), 401)
            self.assertEqual(control.failures['same-client'][1], 1)

if __name__ == '__main__':
    unittest.main()
