"""Create/change a local login without putting the password in shell history."""

import getpass
import json
import os

from access import password_record
from app import DATA_DIR


def main() -> None:
    username = input("Username [admin]: ").strip() or "admin"
    password = getpass.getpass("Password (12+ characters): ")
    if password != getpass.getpass("Confirm password: "):
        raise SystemExit("Passwords do not match; nothing was changed.")
    record = password_record(username, password)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    config = DATA_DIR / "access.json"
    # Replace atomically and give only the current user access to the hash.
    temporary = DATA_DIR / f".access-{os.getpid()}.json"
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as target:
            json.dump(record, target)
        os.replace(temporary, config)
    finally:
        temporary.unlink(missing_ok=True)
    print("Login saved. Restart the app to apply it.")


if __name__ == "__main__":
    main()
