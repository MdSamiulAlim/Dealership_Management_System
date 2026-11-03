#!/usr/bin/env python3
"""AKIJ Feed dealership management web app.

No third-party dependency is required for local use; production uses Gunicorn.
The app serves a responsive browser UI
and JSON API backed by SQLite, so data is stored on the server instead of the
browser.
"""

from __future__ import annotations

import argparse
import csv
import json
import mimetypes
import math
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import uuid
from html import unescape
from datetime import date, datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from access import load_access


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = Path(os.environ.get("DEALERSHIP_DATA_DIR", str(BASE_DIR / "data"))).expanduser().resolve()
DB_PATH = DATA_DIR / "dealership.db"
FISH_PRICE_LIST_PATH = BASE_DIR / "data" / "akij_fish_prices_2025-08-07.csv"
MAX_REQUEST_BYTES = 1024 * 1024
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    "Cache-Control": "no-store",
}

AKIJ_PRODUCTS = [
    ("Layer Layer- 2 50KG", "লেঃ লে-২", 50),
    ("Layer Layer- 1 50KG", "লেঃ লে-১", 50),
    ("LAYER STARTER FEED 50 KG", "লেঃ স্টা-১", 50),
    ("SONALI/COCK GROWER FEED 50 KG", "সোঃ গো-২", 50),
    ("BROILER FINISHER FEED 50 KG", "ব্রোঃ ফি-৩", 50),
    ("BROILER GROWER FEED 50 KG", "102", 50),
    ("BROILER STARTER FEED 50 KG", "ব্রোঃ স্টা-১", 50),
    ("DAIRY CATTLE FEED 25 KG", "ডেইরি", 25),
    ("CATTLE BHUSHI MIX FEED 25 KG", "ভূষি মিক্স", 25),
    ("BEEF CATTLE FEED 25 KG", "বিফ", 25),
    ("MILK BOOSTER CATTLE FEED 25 KG", "মিল্ক বুস্টার", 25),
    ("BEEF BUILDER CATTLE FEED 25 KG", "বিফ বিল্ডার", 25),
    ("Tilapia Grower (Premium) 25KG", "তেলাপিয়া গ্রো", 25),
    ("Carp Grower (Standard) 25KG", "কার্প গ্রো", 25),
    ("Pangas Grower 25 KG", "পাঙ্গাস গ্রো", 25),
    ("Pangus Grower (Premium) 20KG", "পাঙ্গাস গ্রো", 20),
    ("Koi / Sing/ Pabda/ Gulsha/ Tilapia/ Pangus/ Carp Nursery 10KG", "নার্সারি", 10),
    ("Koi / Sing/ Pabda / Gulsha / Tilapia/ Pangus / Carp Hatchery 10Kg", "হ্যাচারি", 10),
]


LEGACY_PRODUCT_CODES = {
    "লেঃ লে-২",
    "লেঃ লে-১",
    "লেঃ স্টা-১",
    "সোঃ গো-২",
    "ব্রোঃ ফি-৩",
    "ব্রোঃ গো-২",
    "ব্রোঃ স্টা-১",
    "ডেইরি",
    "ভূষি মিক্স",
    "বিফ",
    "মিল্ক বুস্টার",
    "বিফ বিল্ডার",
    "তেলাপিয়া গ্রো",
    "কার্প গ্রো",
    "পাঙ্গাস গ্রো",
    "নার্সারি",
    "হ্যাচারি",
    "LAYER-LAYEER-2_50KG",
    "LAYER-LAYEER-1_50KG",
    "LAYER-STARTER_50KG",
    "SONALI_KOK-GROWER-_50KG",
    "BROILER-FINISHER_50KG",
    "BROILER-GROWER_50KG",
    "BROILER-STARTER_50KG",
    "DAIRY-CATTLE_25-KG",
    "CATTLE-BHUSHI-MIX_25-KG",
    "BEEF-CATTLE_25-KG",
    "MILK-BOOSTER_25-KG",
    "BEEF-BUILDER_25-KG-2",
    "TILAPIA-GROWER_20KG",
    "CARP-GROWER_25KG",
    "PANGASH-GROWER_20KG",
    "KOI-SHING-PABDA-CARP-NURSERY_10KG",
    "KOI-SHING-PABDA-CARP-HATCHERY_10KG",
}

PLACEHOLDER_PRODUCTS = [
    "AKIJ Broiler Starter",
    "AKIJ Broiler Grower",
    "AKIJ Layer Mash",
]

AKIJ_SHOP_URL = "https://akijfeed.com/shop/"
AKIJ_CONFIRMED_CODES = {
    "BROILER GROWER FEED 50 KG": "102",
}



SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    product_code TEXT NOT NULL DEFAULT '',
    bag_weight REAL NOT NULL DEFAULT 50,
    opening_stock REAL NOT NULL DEFAULT 0,
    default_rate REAL NOT NULL DEFAULT 0,
    low_stock_level REAL NOT NULL DEFAULT 10,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mobile TEXT DEFAULT '',
    address TEXT DEFAULT '',
    opening_due REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS company_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity REAL NOT NULL,
    bag_weight REAL NOT NULL DEFAULT 50,
    rate REAL NOT NULL,
    total_amount REAL NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('Pending', 'Confirmed', 'Delivered')),
    delivery_date TEXT DEFAULT '',
    invoice_no TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_date TEXT NOT NULL,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity REAL NOT NULL,
    rate REAL NOT NULL,
    total_amount REAL NOT NULL,
    paid_amount REAL NOT NULL DEFAULT 0,
    account TEXT NOT NULL CHECK(account IN ('Cash', 'Bank')),
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_date TEXT NOT NULL,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    account TEXT NOT NULL CHECK(account IN ('Cash', 'Bank')),
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adjust_date TEXT NOT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('Return', 'Damage', 'Loss', 'Manual Add', 'Manual Minus')),
    quantity REAL NOT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    txn_date TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('Company Payment', 'Expense', 'Transport Cost', 'Other Income', 'Other Expense', 'Bank Deposit', 'Bank Withdraw')),
    amount REAL NOT NULL,
    account TEXT NOT NULL CHECK(account IN ('Cash', 'Bank')),
    notes TEXT DEFAULT '',
    transfer_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
"""


def dict_factory(cursor: sqlite3.Cursor, row: sqlite3.Row) -> dict[str, Any]:
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


def db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = dict_factory
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(*, auto_sync: bool = True) -> None:
    fresh = not DB_PATH.exists()
    with db() as conn:
        conn.executescript(SCHEMA)
        ensure_product_columns(conn)
        ensure_transaction_transfers(conn)
        seed_akij_products(conn)
        seed_fish_price_list(conn)
        conn.executescript((BASE_DIR / "financial_integrity.sql").read_text())
        if auto_sync:
            maybe_auto_sync_akij(conn)
        if fresh:
            conn.execute(
                """
                INSERT INTO customers (name, mobile, address, opening_due)
                VALUES ('Cash Customer', '', 'Walk-in sale', 0)
                """
            )


def ensure_product_columns(conn: sqlite3.Connection) -> None:
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(products)").fetchall()}
    if "product_code" not in columns:
        conn.execute("ALTER TABLE products ADD COLUMN product_code TEXT NOT NULL DEFAULT ''")


def ensure_transaction_transfers(conn: sqlite3.Connection) -> None:
    """Upgrade old databases and repair unpaired transfers in one transaction."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(transactions)").fetchall()}
        if "transfer_id" not in columns:
            conn.execute("ALTER TABLE transactions ADD COLUMN transfer_id TEXT")
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS transaction_transfer_account ON transactions(transfer_id, account)")
        marker = "balanced_transfers_v1"
        if not meta_get(conn, marker):
            rows = conn.execute("SELECT * FROM transactions WHERE transfer_id IS NULL AND type IN ('Bank Deposit', 'Bank Withdraw') ORDER BY id").fetchall()
            unused = {row["id"] for row in rows}
            for row in rows:
                if row["id"] not in unused:
                    continue
                unused.remove(row["id"])
                # Existing imports can already contain both sides. Pair equal
                # occurrences first; create a counterpart only when missing.
                partner = next((other for other in rows if other["id"] in unused
                                and other["account"] != row["account"]
                                and all(other[field] == row[field] for field in ("txn_date", "type", "amount", "notes"))), None)
                transfer_id = "legacy-transfer-" + str(row["id"])
                conn.execute("UPDATE transactions SET transfer_id=? WHERE id=?", (transfer_id, row["id"]))
                if partner:
                    unused.remove(partner["id"])
                    conn.execute("UPDATE transactions SET transfer_id=? WHERE id=?", (transfer_id, partner["id"]))
                else:
                    conn.execute("INSERT INTO transactions(txn_date,type,amount,account,notes,transfer_id) VALUES (?,?,?,?,?,?)",
                                 (row["txn_date"], row["type"], row["amount"], "Bank" if row["account"] == "Cash" else "Cash", row["notes"], transfer_id))
            meta_set(conn, marker, "balanced")
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def seed_akij_products(conn: sqlite3.Connection) -> None:
    for name in PLACEHOLDER_PRODUCTS:
        row = conn.execute("SELECT id FROM products WHERE name = ?", (name,)).fetchone()
        if not row:
            continue
        product_id = row["id"]
        usage_count = conn.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM company_orders WHERE product_id = ?)
                + (SELECT COUNT(*) FROM sales WHERE product_id = ?)
                + (SELECT COUNT(*) FROM stock_adjustments WHERE product_id = ?) AS count
            """,
            (product_id, product_id, product_id),
        ).fetchone()["count"]
        if usage_count == 0:
            conn.execute("DELETE FROM products WHERE id = ?", (product_id,))

    conn.executemany(
        """
        INSERT OR IGNORE INTO products (name, product_code, bag_weight, opening_stock, default_rate, low_stock_level)
        VALUES (?, ?, ?, 0, 0, ?)
        """,
        [(name, code, weight, 20 if weight >= 25 else 10) for name, code, weight in AKIJ_PRODUCTS],
    )
    legacy_placeholders = ", ".join("?" for _ in LEGACY_PRODUCT_CODES)
    for name, code, _weight in AKIJ_PRODUCTS:
        conn.execute(
            f"""
            UPDATE products
            SET product_code = ?
            WHERE name = ?
              AND (COALESCE(product_code, '') = '' OR product_code IN ({legacy_placeholders}))
            """,
            (code, name, *LEGACY_PRODUCT_CODES),
        )


def seed_fish_price_list(conn: sqlite3.Connection) -> None:
    """Import the supplied August 7, 2025 bag MRPs once, preserving later edits."""
    import_key = "akij_fish_prices_2025-08-07"
    if meta_get(conn, import_key):
        return

    with FISH_PRICE_LIST_PATH.open(newline="", encoding="utf-8") as price_file:
        for product in csv.DictReader(price_file):
            name = product["name"]
            code = product["product_code"]
            weight = float(product["bag_weight"])
            rate = float(product["mrp_per_bag"])
            # Match the printed code and pack size; generic shop names can
            # describe several floating/sinking variants with different prices.
            current = conn.execute(
                "SELECT id FROM products WHERE product_code = ? AND bag_weight = ?",
                (code, weight),
            ).fetchone()
            if current:
                conn.execute(
                    "UPDATE products SET default_rate = ? WHERE id = ? AND default_rate = 0",
                    (rate, current["id"]),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO products (name, product_code, bag_weight, default_rate, low_stock_level)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(name) DO UPDATE SET default_rate = excluded.default_rate
                    WHERE products.default_rate = 0
                      AND products.product_code = excluded.product_code
                      AND products.bag_weight = excluded.bag_weight
                    """,
                    (name, code, weight, rate, 20 if weight >= 25 else 10),
                )

    meta_set(conn, import_key, "imported")


def fetch_url(url: str) -> bytes:
    request = Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
            "Referer": AKIJ_SHOP_URL,
        },
    )
    with urlopen(request, timeout=30) as response:
        return response.read()


def normalize_product_name(name: str) -> str:
    return re.sub(r"\s+", " ", unescape(name)).strip()


def parse_akij_products(html: str) -> list[dict[str, str]]:
    pattern = re.compile(
        r'<div[^>]+class="[^"]*product[^"]*"[^>]*>.*?'
        r'<img[^>]+(?:bv-data-src|data-src|src)="(?P<image>https://akijfeed\.com/[^"]+?)".*?'
        r'<h2[^>]*class="[^"]*product_title[^"]*"[^>]*>(?P<name>.*?)</h2>',
        re.DOTALL | re.IGNORECASE,
    )
    products: list[dict[str, str]] = []
    seen: set[str] = set()
    for match in pattern.finditer(html):
        name = normalize_product_name(re.sub(r"<[^>]+>", "", match.group("name")))
        image_url = unescape(match.group("image"))
        if not name or name in seen:
            continue
        seen.add(name)
        products.append({"name": name, "image_url": image_url})
    return products


def bn_digits_to_ascii(value: str) -> str:
    table = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
    return value.translate(table)


def extract_code_from_text(text: str) -> str:
    normalized = bn_digits_to_ascii(text)
    matches = re.findall(r"(?:কোড|code)\s*[-:：]?\s*([0-9]{2,4})", normalized, flags=re.IGNORECASE)
    if matches:
        return matches[0]
    matches = re.findall(r"\b([0-9]{3})\b", normalized)
    return matches[0] if matches else ""


def ocr_product_code(image_bytes: bytes) -> str:
    tesseract = shutil.which("tesseract")
    if not tesseract:
        raise RuntimeError("Tesseract OCR is not installed")

    try:
        from PIL import Image, ImageEnhance, ImageOps
    except ImportError as exc:
        raise RuntimeError("Pillow is not installed") from exc

    with tempfile.TemporaryDirectory() as tmpdir:
        source_path = Path(tmpdir) / "source.jpg"
        source_path.write_bytes(image_bytes)
        image = Image.open(source_path).convert("RGB")
        w, h = image.size
        candidates = [
            image,
            image.crop((int(w * 0.68), 0, w, h)),
            image.crop((0, 0, int(w * 0.32), h)),
        ]
        for idx, candidate in enumerate(candidates):
            for rotation in (0, 90, 270):
                processed = candidate.rotate(rotation, expand=True)
                processed = ImageOps.autocontrast(processed.convert("L"))
                processed = ImageEnhance.Contrast(processed).enhance(2.4)
                processed = ImageEnhance.Sharpness(processed).enhance(2.0)
                processed = processed.resize((processed.width * 3, processed.height * 3))
                input_path = Path(tmpdir) / f"candidate_{idx}_{rotation}.png"
                processed.save(input_path)
                result = subprocess.run(
                    [tesseract, str(input_path), "stdout", "-l", "ben+eng", "--psm", "6"],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                code = extract_code_from_text(result.stdout + "\n" + result.stderr)
                if code:
                    return code
    return ""


def sync_akij_products(conn: sqlite3.Connection) -> dict[str, Any]:
    html = fetch_url(AKIJ_SHOP_URL).decode("utf-8", errors="ignore")
    remote_products = parse_akij_products(html)
    synced: list[dict[str, str]] = []
    errors: list[str] = []
    ocr_available = shutil.which("tesseract") is not None

    for product in remote_products:
        name = product["name"]
        current = conn.execute("SELECT id, product_code FROM products WHERE name = ?", (name,)).fetchone()
        if not current:
            continue

        code = AKIJ_CONFIRMED_CODES.get(name, "")
        if not code and ocr_available:
            try:
                image_bytes = fetch_url(product["image_url"])
                code = ocr_product_code(image_bytes)
            except Exception as exc:  # OCR should not block the whole sync.
                errors.append(f"{name}: {exc}")

        if code and code != current["product_code"]:
            conn.execute("UPDATE products SET product_code = ? WHERE id = ?", (code, current["id"]))
            synced.append({"name": name, "product_code": code})

    if not ocr_available:
        errors.append("Install tesseract-ocr and tesseract-ocr-ben on the server for automatic image-code OCR.")

    return {
        "remote_count": len(remote_products),
        "updated_count": len(synced),
        "updated": synced,
        "errors": errors,
        "ocr_available": ocr_available,
    }


def meta_get(conn: sqlite3.Connection, key: str) -> str:
    row = conn.execute("SELECT value FROM app_meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else ""


def meta_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def maybe_auto_sync_akij(conn: sqlite3.Connection) -> None:
    if shutil.which("tesseract") is None:
        return
    today_value = date.today().isoformat()
    if meta_get(conn, "akij_last_sync") == today_value:
        return
    try:
        sync_akij_products(conn)
        meta_set(conn, "akij_last_sync", today_value)
    except Exception as exc:
        print(f"Akij auto sync skipped: {exc}")


def today() -> str:
    return date.today().isoformat()


class InputError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def error_status(error: Exception) -> int:
    return 409 if any(code in str(error) for code in ("insufficient_stock", "linked_record")) else getattr(error, "status", 400)


def error_message(error: Exception) -> str:
    if "insufficient_stock" in str(error):
        return "Insufficient stock. Refresh stock and reduce the quantity before saving."
    if "linked_record" in str(error):
        return "This record has transactions and cannot be deleted. Keep it for the account history."
    return str(error)


def money(value: Any = 0) -> float:
    if isinstance(value, bool) or not isinstance(value, (str, int, float, type(None))):
        raise InputError("Enter a valid amount or quantity.")
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        raise InputError("Enter a valid amount or quantity.")
    if not math.isfinite(number) or abs(number) > 1e12:
        raise InputError("Enter a valid amount or quantity.")
    return math.floor((number + 2.220446049250313e-16) * 100 + .5) / 100


def whole_bags(value: Any, label: str = "Quantity", minimum: int = 1) -> int:
    if isinstance(value, bool) or value is None or str(value).strip() == "":
        raise InputError(f"{label} must be a whole number.")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise InputError(f"{label} must be a whole number.")
    if not math.isfinite(number) or not number.is_integer() or abs(number) > 1e12 or number < minimum:
        raise InputError(f"{label} must be a whole number of {minimum} or more.")
    return int(number)


def valid_date(value: Any, optional: bool = False) -> str:
    text = clean_text(value)
    if optional and not text:
        return ""
    try:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text) or date.fromisoformat(text).isoformat() != text:
            raise ValueError()
    except ValueError:
        raise InputError("Enter a valid date.")
    return text


def nonnegative(value: Any, label: str = "Amount") -> float:
    number = money(value)
    if float(value or 0) < 0:
        raise InputError(f"{label} cannot be negative.")
    return number


def positive(value: Any, label: str = "Amount") -> float:
    number = money(value)
    if number <= 0:
        raise InputError(f"{label} must be greater than zero.")
    return number


def choice(value: Any, choices: tuple, fallback: str = "") -> str:
    text = clean_text(value) or fallback
    if text not in choices:
        raise InputError("Choose " + " or ".join(choices) + ".")
    return text


def calculated_total(payload: dict, total: float) -> float:
    if payload.get("total_amount") is not None and payload["total_amount"] != "" and money(payload["total_amount"]) != total:
        raise InputError("Total must match the calculated quantity and rate.")
    return total


def product_metadata(current: dict, payload: dict) -> dict:
    result = {key: clean_text(payload.get(key, current.get(key))) for key in ("name", "product_code")}
    result.update(bag_weight=positive(payload.get("bag_weight", current.get("bag_weight", 50)), "Bag weight"),
                  default_rate=nonnegative(payload.get("default_rate", current.get("default_rate", 0)), "Rate"),
                  low_stock_level=whole_bags(payload.get("low_stock_level", current.get("low_stock_level", 5)), "Low Stock Alert", 0))
    if not result["name"] or len(result["name"]) > 200 or len(result["product_code"]) > 100:
        raise InputError("Enter a product name (up to 200 characters) and packet code (up to 100).")
    return result


def clean_text(value: Any) -> str:
    return str(value or "").strip()


def require_fields(payload: dict[str, Any], fields: list[str]) -> None:
    missing = [field for field in fields if clean_text(payload.get(field)) == ""]
    if missing:
        raise ValueError(f"Missing required field: {', '.join(missing)}")


def product_stock_sql() -> str:
    return """
    SELECT
        p.*,
        ROUND(
            p.opening_stock
            + COALESCE((SELECT SUM(quantity) FROM company_orders o WHERE o.product_id = p.id AND o.status = 'Delivered'), 0)
            - COALESCE((SELECT SUM(quantity) FROM sales s WHERE s.product_id = p.id), 0)
            + COALESCE((SELECT SUM(CASE WHEN type IN ('Return', 'Manual Add') THEN quantity ELSE -quantity END) FROM stock_adjustments a WHERE a.product_id = p.id), 0),
            2
        ) AS current_stock,
        COALESCE((SELECT SUM(quantity) FROM company_orders o WHERE o.product_id = p.id AND o.status = 'Delivered'), 0) AS received_stock,
        COALESCE((SELECT SUM(quantity) FROM sales s WHERE s.product_id = p.id), 0) AS sold_stock
    FROM products p
    ORDER BY p.name
    """


def customer_due_sql() -> str:
    return """
    SELECT
        c.*,
        ROUND(c.opening_due + COALESCE((SELECT SUM(total_amount) FROM sales s WHERE s.customer_id = c.id), 0), 2) AS total_purchase,
        ROUND(COALESCE((SELECT SUM(paid_amount) FROM sales s WHERE s.customer_id = c.id), 0)
            + COALESCE((SELECT SUM(amount) FROM customer_payments cp WHERE cp.customer_id = c.id), 0), 2) AS total_paid,
        ROUND(c.opening_due + COALESCE((SELECT SUM(total_amount) FROM sales s WHERE s.customer_id = c.id), 0)
            - COALESCE((SELECT SUM(paid_amount) FROM sales s WHERE s.customer_id = c.id), 0)
            - COALESCE((SELECT SUM(amount) FROM customer_payments cp WHERE cp.customer_id = c.id), 0), 2) AS current_due
    FROM customers c
    ORDER BY current_due DESC, c.name
    """


def list_rows(conn: sqlite3.Connection, table: str, order: str = "id DESC") -> list[dict[str, Any]]:
    return conn.execute(f"SELECT * FROM {table} ORDER BY {order}").fetchall()


def joined_rows(conn: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    return {
        "products": conn.execute(product_stock_sql()).fetchall(),
        "customers": conn.execute(customer_due_sql()).fetchall(),
        "orders": conn.execute(
            """
            SELECT o.*, p.name AS product_name
            FROM company_orders o
            JOIN products p ON p.id = o.product_id
            ORDER BY o.order_date DESC, o.id DESC
            """
        ).fetchall(),
        "sales": conn.execute(
            """
            SELECT s.*, c.name AS customer_name, p.name AS product_name,
                   ROUND(s.total_amount - s.paid_amount, 2) AS due_amount
            FROM sales s
            JOIN customers c ON c.id = s.customer_id
            JOIN products p ON p.id = s.product_id
            ORDER BY s.sale_date DESC, s.id DESC
            """
        ).fetchall(),
        "payments": conn.execute(
            """
            SELECT cp.*, c.name AS customer_name
            FROM customer_payments cp
            JOIN customers c ON c.id = cp.customer_id
            ORDER BY cp.payment_date DESC, cp.id DESC
            """
        ).fetchall(),
        "adjustments": conn.execute(
            """
            SELECT a.*, p.name AS product_name
            FROM stock_adjustments a
            JOIN products p ON p.id = a.product_id
            ORDER BY a.adjust_date DESC, a.id DESC
            """
        ).fetchall(),
        "transactions": list_rows(conn, "transactions", "txn_date DESC, id DESC"),
    }


def scalar(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...] = ()) -> float:
    row = conn.execute(sql, params).fetchone()
    return money(next(iter(row.values())) if row else 0)


def dashboard(conn: sqlite3.Connection) -> dict[str, Any]:
    today_value = today()
    total_sales_today = scalar(conn, "SELECT SUM(total_amount) FROM sales WHERE sale_date = ?", (today_value,))
    today_orders = scalar(conn, "SELECT COUNT(*) FROM company_orders WHERE order_date = ?", (today_value,))
    received_today = scalar(
        conn,
        """
        SELECT
            COALESCE((SELECT SUM(paid_amount) FROM sales WHERE sale_date = ?), 0)
            + COALESCE((SELECT SUM(amount) FROM customer_payments WHERE payment_date = ?), 0)
        """,
        (today_value, today_value),
    )
    customer_due = scalar(
        conn,
        """
        SELECT SUM(current_due) FROM (
            SELECT c.opening_due + COALESCE((SELECT SUM(total_amount) FROM sales s WHERE s.customer_id = c.id), 0)
                - COALESCE((SELECT SUM(paid_amount) FROM sales s WHERE s.customer_id = c.id), 0)
                - COALESCE((SELECT SUM(amount) FROM customer_payments cp WHERE cp.customer_id = c.id), 0) AS current_due
            FROM customers c
        )
        """,
    )
    company_payable = scalar(
        conn,
        """
        SELECT
            COALESCE((SELECT SUM(total_amount) FROM company_orders WHERE status = 'Delivered'), 0)
            - COALESCE((SELECT SUM(amount) FROM transactions WHERE type = 'Company Payment'), 0)
        """
    )
    cash_balance = scalar(
        conn,
        """
        SELECT
            COALESCE((SELECT SUM(paid_amount) FROM sales WHERE account = 'Cash'), 0)
            + COALESCE((SELECT SUM(amount) FROM customer_payments WHERE account = 'Cash'), 0)
            + COALESCE((SELECT SUM(amount) FROM transactions WHERE account = 'Cash' AND type IN ('Other Income', 'Bank Withdraw')), 0)
            - COALESCE((SELECT SUM(amount) FROM transactions WHERE account = 'Cash' AND type IN ('Company Payment', 'Expense', 'Transport Cost', 'Other Expense', 'Bank Deposit')), 0)
        """
    )
    bank_balance = scalar(
        conn,
        """
        SELECT
            COALESCE((SELECT SUM(paid_amount) FROM sales WHERE account = 'Bank'), 0)
            + COALESCE((SELECT SUM(amount) FROM customer_payments WHERE account = 'Bank'), 0)
            + COALESCE((SELECT SUM(amount) FROM transactions WHERE account = 'Bank' AND type IN ('Other Income', 'Bank Deposit')), 0)
            - COALESCE((SELECT SUM(amount) FROM transactions WHERE account = 'Bank' AND type IN ('Company Payment', 'Expense', 'Transport Cost', 'Other Expense', 'Bank Withdraw')), 0)
        """
    )
    stock_rows = conn.execute(product_stock_sql()).fetchall()
    low_stock = [row for row in stock_rows if money(row["current_stock"]) <= money(row["low_stock_level"])]
    return {
        "today": today_value,
        "total_sales_today": total_sales_today,
        "today_orders": int(today_orders),
        "received_today": received_today,
        "customer_due": customer_due,
        "company_payable": company_payable,
        "cash_balance": cash_balance,
        "bank_balance": bank_balance,
        "current_stock": sum(money(row["current_stock"]) for row in stock_rows),
        "low_stock": low_stock,
    }


def reports(conn: sqlite3.Connection) -> dict[str, Any]:
    return {
        "daily_sales": conn.execute(
            """
            SELECT sale_date AS date, COUNT(*) AS invoice_count, ROUND(SUM(quantity), 2) AS bags,
                   ROUND(SUM(total_amount), 2) AS sales, ROUND(SUM(paid_amount), 2) AS received,
                   ROUND(SUM(total_amount - paid_amount), 2) AS due
            FROM sales
            GROUP BY sale_date
            ORDER BY sale_date DESC
            LIMIT 31
            """
        ).fetchall(),
        "monthly_sales": conn.execute(
            """
            SELECT substr(sale_date, 1, 7) AS month, ROUND(SUM(quantity), 2) AS bags,
                   ROUND(SUM(total_amount), 2) AS sales, ROUND(SUM(paid_amount), 2) AS received
            FROM sales
            GROUP BY substr(sale_date, 1, 7)
            ORDER BY month DESC
            LIMIT 12
            """
        ).fetchall(),
        "product_sales": conn.execute(
            """
            SELECT p.name, ROUND(SUM(s.quantity), 2) AS bags, ROUND(SUM(s.total_amount), 2) AS amount
            FROM sales s
            JOIN products p ON p.id = s.product_id
            GROUP BY p.id
            ORDER BY amount DESC
            """
        ).fetchall(),
        "customer_sales": conn.execute(
            """
            SELECT c.name, ROUND(SUM(s.total_amount), 2) AS purchase, ROUND(SUM(s.paid_amount), 2) AS paid,
                   ROUND(SUM(s.total_amount - s.paid_amount), 2) AS sale_due
            FROM sales s
            JOIN customers c ON c.id = s.customer_id
            GROUP BY c.id
            ORDER BY purchase DESC
            """
        ).fetchall(),
        "stock_report": conn.execute(product_stock_sql()).fetchall(),
        "due_report": conn.execute(customer_due_sql()).fetchall(),
        "order_report": conn.execute(
            """
            SELECT o.status, COUNT(*) AS order_count, ROUND(SUM(o.quantity), 2) AS bags,
                   ROUND(SUM(o.total_amount), 2) AS amount
            FROM company_orders o
            GROUP BY o.status
            ORDER BY o.status
            """
        ).fetchall(),
        "cash_bank": [
            {"account": "Cash", "balance": dashboard(conn)["cash_balance"]},
            {"account": "Bank", "balance": dashboard(conn)["bank_balance"]},
        ],
    }


def bootstrap() -> dict[str, Any]:
    with db() as conn:
        data = joined_rows(conn)
        data["dashboard"] = dashboard(conn)
        data["reports"] = reports(conn)
        return data


def insert_product(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    next_record = product_metadata({}, payload)
    conn.execute("INSERT INTO products(name,product_code,bag_weight,opening_stock,default_rate,low_stock_level) VALUES (?,?,?,?,?,?)",
                 (next_record["name"], next_record["product_code"], next_record["bag_weight"], whole_bags(payload.get("opening_stock", 0), "Opening Stock", 0), next_record["default_rate"], next_record["low_stock_level"]))


def insert_customer(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    require_fields(payload, ["name"])
    if len(clean_text(payload["name"])) > 200 or len(clean_text(payload.get("mobile"))) > 50 or len(clean_text(payload.get("address"))) > 1000:
        raise InputError("Customer fields exceed their length limits.")
    conn.execute(
        """
        INSERT INTO customers (name, mobile, address, opening_due)
        VALUES (?, ?, ?, ?)
        """,
        (
            clean_text(payload["name"]),
            clean_text(payload.get("mobile")),
            clean_text(payload.get("address")),
            money(payload.get("opening_due")),
        ),
    )


def insert_order(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    require_fields(payload, ["order_date", "product_id", "quantity", "rate"])
    quantity = whole_bags(payload["quantity"])
    rate = nonnegative(payload["rate"], "Rate")
    conn.execute(
        """
        INSERT INTO company_orders
        (order_date, product_id, quantity, bag_weight, rate, total_amount, status, delivery_date, invoice_no, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            valid_date(payload["order_date"]),
            whole_bags(payload["product_id"], "Product"),
            quantity,
            positive(payload.get("bag_weight", 50), "Bag weight"),
            rate,
            calculated_total(payload, money(quantity * rate)),
            choice(payload.get("status"), ("Pending", "Confirmed", "Delivered"), "Pending"),
            valid_date(payload.get("delivery_date"), True),
            clean_text(payload.get("invoice_no")),
            clean_text(payload.get("notes")),
        ),
    )


def insert_sale(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    require_fields(payload, ["sale_date", "customer_id", "product_id", "quantity", "rate"])
    quantity = whole_bags(payload["quantity"])
    rate = nonnegative(payload["rate"], "Rate")
    total = calculated_total(payload, money(quantity * rate))
    paid = nonnegative(payload.get("paid_amount"), "Paid amount")
    if paid > total:
        raise InputError("Paid amount cannot exceed the sale total.")
    conn.execute(
        """
        INSERT INTO sales
        (sale_date, customer_id, product_id, quantity, rate, total_amount, paid_amount, account, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            valid_date(payload["sale_date"]),
            whole_bags(payload["customer_id"], "Customer"),
            whole_bags(payload["product_id"], "Product"),
            quantity,
            rate,
            total,
            paid,
            choice(payload.get("account"), ("Cash", "Bank"), "Cash"),
            clean_text(payload.get("notes")),
        ),
    )


def insert_payment(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    require_fields(payload, ["payment_date", "customer_id", "amount"])
    conn.execute(
        """
        INSERT INTO customer_payments (payment_date, customer_id, amount, account, notes)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            valid_date(payload["payment_date"]),
            whole_bags(payload["customer_id"], "Customer"),
            positive(payload["amount"]),
            choice(payload.get("account"), ("Cash", "Bank"), "Cash"),
            clean_text(payload.get("notes")),
        ),
    )


def insert_adjustment(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    require_fields(payload, ["adjust_date", "product_id", "type", "quantity"])
    conn.execute(
        """
        INSERT INTO stock_adjustments (adjust_date, product_id, type, quantity, notes)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            valid_date(payload["adjust_date"]),
            whole_bags(payload["product_id"], "Product"),
            choice(payload["type"], ("Return", "Damage", "Loss", "Manual Add", "Manual Minus")),
            whole_bags(payload["quantity"]),
            clean_text(payload.get("notes")),
        ),
    )


def insert_transaction(conn: sqlite3.Connection, payload: dict[str, Any]) -> None:
    require_fields(payload, ["txn_date", "type", "amount"])
    txn_date = valid_date(payload["txn_date"])
    kind = choice(payload["type"], ("Company Payment", "Expense", "Transport Cost", "Other Income", "Other Expense", "Bank Deposit", "Bank Withdraw"))
    amount = positive(payload["amount"])
    account = choice(payload.get("account"), ("Cash", "Bank"), "Cash")
    notes = clean_text(payload.get("notes"))
    if kind not in ("Bank Deposit", "Bank Withdraw"):
        conn.execute("INSERT INTO transactions(txn_date,type,amount,account,notes) VALUES (?,?,?,?,?)",
                     (txn_date, kind, amount, account, notes))
        return
    source = "Cash" if kind == "Bank Deposit" else "Bank"
    transfer_id = str(uuid.uuid4())
    # A savepoint also protects direct callers that catch an error inside their
    # outer transaction. Neither entry survives if the counterpart fails.
    conn.execute("SAVEPOINT account_transfer")
    try:
        conn.executemany("INSERT INTO transactions(txn_date,type,amount,account,notes,transfer_id) VALUES (?,?,?,?,?,?)",
                         [(txn_date, kind, amount, side, notes, transfer_id) for side in (source, "Bank" if source == "Cash" else "Cash")])
        conn.execute("RELEASE SAVEPOINT account_transfer")
    except Exception:
        conn.execute("ROLLBACK TO SAVEPOINT account_transfer")
        conn.execute("RELEASE SAVEPOINT account_transfer")
        raise


def delete_transaction(conn: sqlite3.Connection, record_id: int) -> None:
    row = conn.execute("SELECT transfer_id FROM transactions WHERE id=?", (record_id,)).fetchone()
    if row and row["transfer_id"]:
        conn.execute("DELETE FROM transactions WHERE transfer_id=?", (row["transfer_id"],))
    else:
        conn.execute("DELETE FROM transactions WHERE id=?", (record_id,))


INSERT_HANDLERS = {
    "products": insert_product,
    "customers": insert_customer,
    "orders": insert_order,
    "sales": insert_sale,
    "payments": insert_payment,
    "adjustments": insert_adjustment,
    "transactions": insert_transaction,
}

DELETE_TABLES = {
    "products": "products",
    "customers": "customers",
    "orders": "company_orders",
    "sales": "sales",
    "payments": "customer_payments",
    "adjustments": "stock_adjustments",
    "transactions": "transactions",
}


class AppRoutes:
    """Routes shared by the local HTTP server and production WSGI server."""

    access = None

    def authorize(self, *, mutation: bool = False) -> bool:
        if self.access is not None:
            status = self.access.verify(self.headers.get("Authorization", ""), self.address_string())
            if status != 200:
                body = json.dumps({"error": "Login required" if status == 401 else "Too many attempts. Try again in one minute."}).encode()
                self.send_response(status)
                if status == 401:
                    self.send_header("WWW-Authenticate", 'Basic realm="AKIJ Dealership", charset="UTF-8"')
                else:
                    self.send_header("Retry-After", "60")
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.write_body(body)
                return False
        if mutation:
            origin = self.headers.get("Origin")
            expected = os.environ.get("DEALERSHIP_PUBLIC_ORIGIN", "").rstrip("/")
            same_origin = (
                origin == expected if expected else
                origin is not None and urlparse(origin).scheme in ("http", "https")
                and urlparse(origin).netloc.lower() == self.headers.get("Host", "").lower()
            )
            if self.headers.get("Sec-Fetch-Site") == "cross-site" or (origin and not same_origin):
                self.json_response(403, {"error": "Use the app's own website to save changes."})
                return False
            if self.command != "DELETE" and self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
                self.json_response(415, {"error": "Expected application/json"})
                return False
            try:
                # WSGI supplies an empty CONTENT_LENGTH for bodyless DELETE.
                length = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                length = -1
            if length < 0 or length > MAX_REQUEST_BYTES:
                self.json_response(413 if length > MAX_REQUEST_BYTES else 400, {"error": "Invalid request size"})
                return False
        return True

    def write_body(self, body: bytes) -> None:
        if self.command != "HEAD":
            self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[{datetime.now().isoformat(timespec='seconds')}] {self.address_string()} {format % args}")

    def json_response(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.write_body(body)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or "0")
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        payload = json.loads(raw or "{}")
        if not isinstance(payload, dict):
            raise ValueError("Expected a JSON object")
        return payload

    def do_HEAD(self) -> None:
        self.do_GET()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            self.json_response(200, {"status": "ok"})
            return
        if not self.authorize():
            return
        if parsed.path == "/api/bootstrap":
            self.json_response(200, bootstrap())
            return
        if parsed.path == "/api/export":
            payload = bootstrap()
            body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Disposition", "attachment; filename=dealership-export.json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.write_body(body)
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        if not self.authorize(mutation=True):
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/sync-akij":
            try:
                with db() as conn:
                    sync_result = sync_akij_products(conn)
                    meta_set(conn, "akij_last_sync", date.today().isoformat())
                payload = bootstrap()
                payload["sync"] = sync_result
                self.json_response(200, payload)
            except Exception as exc:
                self.json_response(500, {"error": str(exc)})
            return
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 2 and parts[0] == "api" and parts[1] in INSERT_HANDLERS:
            try:
                payload = self.read_json()
                with db() as conn:
                    INSERT_HANDLERS[parts[1]](conn, payload)
                self.json_response(201, bootstrap())
            except (ValueError, sqlite3.Error, json.JSONDecodeError) as exc:
                self.json_response(error_status(exc), {"error": error_message(exc)})
            return
        self.json_response(404, {"error": "Not found"})

    def do_PATCH(self) -> None:
        if not self.authorize(mutation=True):
            return
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
        if len(parts) == 3 and parts[0] == "api" and parts[1] == "products":
            try:
                record_id = whole_bags(parts[2], "Product")
                payload = self.read_json()
                with db() as conn:
                    current = conn.execute("SELECT * FROM products WHERE id=?", (record_id,)).fetchone()
                    if not current:
                        raise InputError("Product not found", 404)
                    original = payload.get("original")
                    if not isinstance(original, dict) or any(key not in original for key in current):
                        raise InputError("Reload the complete product before editing.", 409)
                    if any(key in payload for key in ("opening_stock", "current_stock", "received_stock", "sold_stock")):
                        raise InputError("Use Stock Adjustment to change stock quantities.")
                    next_record = product_metadata(current, payload)
                    columns = list(current)
                    condition = " AND ".join(f"{key} IS ?" for key in columns)
                    cursor = conn.execute("UPDATE products SET name=?,product_code=?,bag_weight=?,default_rate=?,low_stock_level=? WHERE id=? AND " + condition,
                                          (*next_record.values(), record_id, *(original[key] for key in columns)))
                    if not cursor.rowcount:
                        raise InputError("This product changed on another device. Reopen Edit to load the latest record.", 409)
                self.json_response(200, bootstrap())
            except (ValueError, sqlite3.Error, json.JSONDecodeError) as exc:
                self.json_response(error_status(exc), {"error": error_message(exc)})
            return
        self.json_response(404, {"error": "Not found"})

    def do_DELETE(self) -> None:
        if not self.authorize(mutation=True):
            return
        parsed = urlparse(self.path)
        parts = parsed.path.strip("/").split("/")
        query = parse_qs(parsed.query)
        if len(parts) == 3 and parts[0] == "api" and parts[1] in DELETE_TABLES:
            try:
                record_id = whole_bags(parts[2], "Record")
                with db() as conn:
                    if parts[1] == "transactions":
                        delete_transaction(conn, record_id)
                    else:
                        conn.execute(f"DELETE FROM {DELETE_TABLES[parts[1]]} WHERE id = ?", (record_id,))
                self.json_response(200, bootstrap())
            except (ValueError, sqlite3.Error) as exc:
                self.json_response(error_status(exc), {"error": error_message(exc)})
            return
        if parts == ["api", "reset"] and query.get("confirm") == ["yes"]:
            if os.environ.get("DEALERSHIP_ALLOW_RESET", "0") != "1":
                self.json_response(403, {"error": "Database reset is disabled. Use server administration for this action."})
                return
            try:
                if DB_PATH.exists():
                    os.remove(DB_PATH)
                init_db()
                self.json_response(200, bootstrap())
            except OSError as exc:
                self.json_response(500, {"error": str(exc)})
            return
        self.json_response(404, {"error": "Not found"})

    def serve_static(self, path: str) -> None:
        if path in ("", "/"):
            file_path = STATIC_DIR / "index.html"
        elif path.startswith("/static/"):
            file_path = BASE_DIR / path.lstrip("/")
        else:
            file_path = STATIC_DIR / "index.html"

        try:
            resolved = file_path.resolve()
            if STATIC_DIR.resolve() not in resolved.parents and resolved != STATIC_DIR / "index.html":
                self.send_error(403)
                return
            content = resolved.read_bytes()
        except FileNotFoundError:
            self.send_error(404)
            return

        content_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.write_body(content)


class AppHandler(AppRoutes, SimpleHTTPRequestHandler):
    server_version = "DealershipApp/1.0"

    def __init__(self, request, client_address, server):
        self.access = server.access
        super().__init__(request, client_address, server)

    def end_headers(self) -> None:
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        super().end_headers()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the AKIJ Feed dealership web app")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind, use 0.0.0.0 for LAN/server access")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")), help="Port to bind")
    args = parser.parse_args()

    require_login = args.host not in ("127.0.0.1", "localhost", "::1") or os.environ.get("DEALERSHIP_REQUIRE_AUTH") == "1"
    try:
        access = load_access(DATA_DIR, required=require_login)
    except (ValueError, KeyError, OSError) as exc:
        parser.error(str(exc))
    init_db()
    httpd = ThreadingHTTPServer((args.host, args.port), AppHandler)
    httpd.access = access
    print(f"Dealership app running at http://{args.host}:{args.port}")
    print(f"Database: {DB_PATH}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
