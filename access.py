"""Shared password access for the dealership's owner, over HTTPS in production."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from collections import OrderedDict
from pathlib import Path


ITERATIONS = 600_000


def password_record(username: str, password: str) -> dict[str, str]:
    if not username or ":" in username or len(username) > 128:
        raise ValueError("Username must be 1–128 characters without a colon.")
    if len(password) < 12 or len(password.encode("utf-8")) > 1024:
        raise ValueError("Use a password of at least 12 characters (at most 1024 bytes).")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, ITERATIONS)
    return {"username": username, "salt": salt.hex(), "digest": digest.hex()}


class AccessControl:
    def __init__(self, record: dict[str, str]):
        self.username = record["username"]
        self.salt = bytes.fromhex(record["salt"])
        self.digest = bytes.fromhex(record["digest"])
        if not self.username or len(self.salt) != 16 or len(self.digest) != 32:
            raise ValueError("Invalid access configuration.")
        self.failures: OrderedDict[str, tuple[float, int]] = OrderedDict()
        self.lock = threading.Lock()

    def verify(self, authorization: str, address: str) -> int:
        # Reserve one attempt atomically BEFORE the expensive password hash.
        # In-flight requests count too, so concurrent guesses cannot pass a stale
        # admission check. Anonymous browser challenges consume no attempt.
        if not authorization:
            return 401
        now = time.monotonic()
        with self.lock:
            since, count = self.failures.get(address, (now, 0))
            if now - since >= 60:
                since, count = now, 0
            if count >= 10:
                return 429
            self.failures[address] = (since, count + 1)
            self.failures.move_to_end(address)
            while len(self.failures) > 1024:
                self.failures.popitem(last=False)

        username, password = "", ""
        try:
            scheme, encoded = authorization.split(" ", 1)
            if scheme.lower() == "basic" and len(encoded) <= 4096:
                decoded = base64.b64decode(encoded, validate=True).decode("utf-8")
                username, separator, password = decoded.partition(":")
                if not separator:
                    username, password = "", ""
        except (ValueError, UnicodeError, binascii.Error):
            pass

        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), self.salt, ITERATIONS)
        valid = hmac.compare_digest(digest, self.digest)
        valid_user = hmac.compare_digest(username.encode("utf-8"), self.username.encode("utf-8"))
        with self.lock:
            if valid and valid_user:
                # A slow success from an expired window must not clear the new one.
                current = self.failures.get(address)
                if current is not None and current[0] == since:
                    self.failures.pop(address, None)
                return 200

        return 401


def load_access(data_dir: Path, *, required: bool) -> AccessControl | None:
    password = os.environ.get("DEALERSHIP_PASSWORD")
    if password is not None:
        return AccessControl(password_record(os.environ.get("DEALERSHIP_USERNAME", "admin"), password))
    config = data_dir / "access.json"
    if config.exists():
        return AccessControl(json.loads(config.read_text(encoding="utf-8")))
    if required:
        raise ValueError(
            "Login is required for network access. Set DEALERSHIP_PASSWORD (12+ characters) "
            "or run: python3 configure_access.py"
        )
    return None
