"""Exercise the actual production routes using a disposable SQLite database."""

import base64
from io import BytesIO
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit
from wsgiref.util import setup_testing_defaults
from wsgiref.validate import validator

import app
from access import AccessControl, load_access, password_record
from wsgi import create_application


TEST_PASSWORD = "test-only-password-42"


class OnlineTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.data_dir = Path(self.directory.name)
        self.env_patch = patch.dict(os.environ, {
            "DEALERSHIP_USERNAME": "owner",
            "DEALERSHIP_PASSWORD": TEST_PASSWORD,
            "DEALERSHIP_PUBLIC_ORIGIN": "https://dealer.example",
            "DEALERSHIP_ALLOW_RESET": "0",
        })
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        for name, value in (("DATA_DIR", self.data_dir), ("DB_PATH", self.data_dir / "dealership.db")):
            replacement = patch.object(app, name, value)
            replacement.start()
            self.addCleanup(replacement.stop)
        self.application = validator(create_application())

    def request(self, path, method="GET", payload=None, *, auth=True, password=TEST_PASSWORD,
                origin=None, content_type="application/json", raw=None, length=None):
        environ = {}
        setup_testing_defaults(environ)
        parsed = urlsplit(path)
        body = raw if raw is not None else json.dumps(payload or {}).encode()
        environ.update({
            "REQUEST_METHOD": method,
            "PATH_INFO": parsed.path,
            "QUERY_STRING": parsed.query,
            "HTTP_HOST": "dealer.example",
            "REMOTE_ADDR": "127.0.0.1",
            "CONTENT_TYPE": content_type,
            "CONTENT_LENGTH": str(len(body) if length is None else length),
            "wsgi.input": BytesIO(body),
        })
        if auth:
            credential = base64.b64encode(f"owner:{password}".encode()).decode()
            environ["HTTP_AUTHORIZATION"] = "Basic " + credential
        if origin is not None:
            environ["HTTP_ORIGIN"] = origin
        response = {}

        def start_response(status, headers, exc_info=None):
            response.update(status=int(status.split()[0]), headers=dict(headers))

        result = self.application(environ, start_response)
        try:
            response["body"] = b"".join(result)
        finally:
            result.close()
        if method != "HEAD":
            self.assertEqual(int(response["headers"]["Content-Length"]), len(response["body"]))
        return response

    def test_private_reads_and_every_write_require_login(self):
        for path in ("/", "/api/bootstrap", "/api/export", "/static/app.js"):
            response = self.request(path, auth=False)
            self.assertEqual(response["status"], 401, path)
            self.assertIn("Basic", response["headers"]["WWW-Authenticate"])
            self.assertNotIn(b"products", response["body"])
        for method, path in (("POST", "/api/customers"), ("PATCH", "/api/products/4"),
                             ("DELETE", "/api/products/4"), ("DELETE", "/api/reset?confirm=yes")):
            self.assertEqual(self.request(path, method, auth=False)["status"], 401)
        self.assertEqual(self.request("/api/bootstrap", "HEAD", auth=False)["status"], 401)

    def test_health_is_public_and_contains_no_business_data(self):
        result = self.request("/healthz", auth=False)
        self.assertEqual(result["status"], 200)
        self.assertEqual(json.loads(result["body"]), {"status": "ok"})

    def test_correct_password_bootstrap_prices_and_page(self):
        result = self.request("/api/bootstrap")
        self.assertEqual(result["status"], 200)
        products = json.loads(result["body"])["products"]
        self.assertEqual(len(products), 60)
        coded = {p["product_code"]: p for p in products}
        self.assertEqual(coded["513"]["default_rate"], 1950)
        self.assertEqual(coded["623"]["default_rate"], 1312.5)
        self.assertEqual(coded["801"]["bag_weight"], 5)
        self.assertEqual(self.request("/")["status"], 200)
        self.assertEqual(self.request("/static/app.js")["status"], 200)
        self.assertEqual(result["headers"]["Cache-Control"], "no-store")
        self.assertEqual(result["headers"]["X-Frame-Options"], "DENY")

    def test_two_devices_share_saved_data_across_restart(self):
        result = self.request("/api/customers", "POST", {"name": "Mobile customer"}, origin="https://dealer.example")
        self.assertEqual(result["status"], 201)
        self.application = validator(create_application())
        data = json.loads(self.request("/api/bootstrap")["body"])
        self.assertTrue(any(c["name"] == "Mobile customer" for c in data["customers"]))
        product = next(p for p in data["products"] if p["product_code"] == "513")
        saved = self.request(f"/api/products/{product['id']}", "PATCH", {"product_code": "513", "default_rate": 2000, "original": product})
        self.assertEqual(saved["status"], 200)
        self.application = validator(create_application())
        data = json.loads(self.request("/api/bootstrap")["body"])
        self.assertEqual(next(p for p in data["products"] if p["product_code"] == "513")["default_rate"], 2000)

    def test_invalid_record_contract_matches_web_routes(self):
        data = json.loads(self.request("/api/bootstrap")["body"])
        cases = json.loads((Path(__file__).parent / "online-site/tests/invalid-records.json").read_text())
        for case in cases:
            payload = json.loads(json.dumps(case["payload"]).replace('"$product"', str(data["products"][0]["id"])).replace('"$customer"', str(data["customers"][0]["id"])))
            with self.subTest(case=case):
                result = self.request("/api/" + case["entity"], "POST", payload)
                self.assertEqual(result["status"], 400, result["body"])
        after = json.loads(self.request("/api/bootstrap")["body"])
        for key in ("sales", "payments", "orders", "adjustments", "transactions"):
            self.assertEqual(after[key], [], key)

    def test_delete_parents_preserves_cash_company_payable_and_history(self):
        created = self.request("/api/customers", "POST", {"name": "Paid customer"})
        customer = next(c for c in json.loads(created["body"])["customers"] if c["name"] == "Paid customer")
        self.assertEqual(self.request("/api/payments", "POST", {"customer_id": customer["id"], "payment_date": "2026-10-21", "amount": 100, "account": "Cash"})["status"], 201)
        self.assertEqual(self.request(f"/api/customers/{customer['id']}", "DELETE")["status"], 409)
        created = self.request("/api/products", "POST", {"name": "Received product"})
        product = next(p for p in json.loads(created["body"])["products"] if p["name"] == "Received product")
        self.assertEqual(self.request("/api/orders", "POST", {"product_id": product["id"], "order_date": "2026-10-21", "quantity": 10, "rate": 100, "status": "Delivered"})["status"], 201)
        self.assertEqual(self.request(f"/api/products/{product['id']}", "DELETE")["status"], 409)
        data = json.loads(self.request("/api/bootstrap")["body"])
        self.assertEqual(data["dashboard"]["cash_balance"], 100)
        self.assertEqual(data["dashboard"]["company_payable"], 1000)
        self.assertEqual(len(data["payments"]), 1)
        self.assertEqual(len(data["orders"]), 1)

    def test_bodyless_delete_accepts_empty_wsgi_content_length_for_every_button(self):
        data = json.loads(self.request('/api/products', 'POST', {'name':'Delete foundation','opening_stock':20})['body'])
        product = next(p for p in data['products'] if p['name']=='Delete foundation')
        customer = data['customers'][0]
        cases = [
            ('products', {'name':'Unused delete product'}),
            ('customers', {'name':'Unused delete customer'}),
            ('orders', {'product_id':product['id'],'order_date':'2026-10-24','quantity':1,'rate':100,'status':'Pending'}),
            ('sales', {'product_id':product['id'],'customer_id':customer['id'],'sale_date':'2026-10-24','quantity':1,'rate':100}),
            ('payments', {'customer_id':customer['id'],'payment_date':'2026-10-24','amount':10,'account':'Cash'}),
            ('adjustments', {'product_id':product['id'],'adjust_date':'2026-10-24','quantity':1,'type':'Manual Add'}),
            ('transactions', {'txn_date':'2026-10-24','type':'Expense','amount':1,'account':'Cash'}),
        ]
        for entity,payload in cases:
            with self.subTest(entity=entity):
                created=self.request('/api/'+entity,'POST',payload)
                self.assertEqual(created['status'],201,created['body'])
                rows=json.loads(created['body'])[entity]
                record=max(rows,key=lambda row:row['id'])
                removed=self.request('/api/'+entity+'/'+str(record['id']),'DELETE',raw=b'',length='',content_type='')
                self.assertEqual(removed['status'],200,removed['body'])
                self.assertFalse(any(row['id']==record['id'] for row in json.loads(removed['body'])[entity]))
        # Empty transport length does not weaken linked-history safeguards.
        self.request('/api/payments','POST',{'customer_id':customer['id'],'payment_date':'2026-10-24','amount':10,'account':'Cash'})
        protected=self.request('/api/customers/'+str(customer['id']),'DELETE',raw=b'',length='',content_type='')
        self.assertEqual(protected['status'],409,protected['body'])

    def test_product_edit_needs_original_and_rejects_stale_device(self):
        original = json.loads(self.request("/api/bootstrap")["body"])["products"][0]
        path = f"/api/products/{original['id']}"
        self.assertEqual(self.request(path, "PATCH", {"default_rate": 500})["status"], 409)
        self.assertEqual(self.request(path, "PATCH", {"default_rate": 500, "original": original})["status"], 200)
        self.assertEqual(self.request(path, "PATCH", {"default_rate": 100, "original": original})["status"], 409)
        data = json.loads(self.request("/api/bootstrap")["body"])
        self.assertEqual(next(p for p in data["products"] if p["id"] == original["id"])["default_rate"], 500)

    def test_atomic_stock_limit_under_concurrent_sales(self):
        from concurrent.futures import ThreadPoolExecutor
        data = json.loads(self.request("/api/products", "POST", {"name": "Three bags", "opening_stock": 3})["body"])
        product = next(p for p in data["products"] if p["name"] == "Three bags")
        payload = {"sale_date": "2026-10-21", "product_id": product["id"], "customer_id": data["customers"][0]["id"], "quantity": 2, "rate": 100}
        with ThreadPoolExecutor(max_workers=2) as executor:
            statuses = list(executor.map(lambda _: self.request("/api/sales", "POST", payload)["status"], range(2)))
        self.assertEqual(sorted(statuses), [201, 409])
        result = json.loads(self.request("/api/bootstrap")["body"])
        self.assertEqual(len(result["sales"]), 1)
        self.assertEqual(next(p for p in result["products"] if p["id"] == product["id"])["current_stock"], 1)
        self.assertEqual(self.request(f"/api/products/{product['id']}", "DELETE")["status"], 409)


    def test_bank_transfers_conserve_money_and_delete_both_sides(self):
        for account in ("Cash", "Bank"):
            with self.subTest(delete_side=account):
                with app.db() as conn:
                    conn.execute("DELETE FROM transactions")
                self.assertEqual(self.request("/api/transactions", "POST", {"txn_date": "2026-10-23", "type": "Other Income", "amount": 1000, "account": "Cash"})["status"], 201)
                deposit = self.request("/api/transactions", "POST", {"txn_date": "2026-10-23", "type": "Bank Deposit", "amount": 100, "account": "Cash"})
                self.assertEqual(deposit["status"], 201)
                data = json.loads(deposit["body"])
                self.assertEqual(data["dashboard"]["cash_balance"], 900)
                self.assertEqual(data["dashboard"]["bank_balance"], 100)
                pair = [row for row in data["transactions"] if row["type"] == "Bank Deposit"]
                self.assertEqual(len(pair), 2)
                self.assertEqual(pair[0]["transfer_id"], pair[1]["transfer_id"])
                withdraw = self.request("/api/transactions", "POST", {"txn_date": "2026-10-23", "type": "Bank Withdraw", "amount": 25, "account": "Cash"})
                self.assertEqual(withdraw["status"], 201)
                balances = json.loads(withdraw["body"])["dashboard"]
                self.assertEqual((balances["cash_balance"], balances["bank_balance"]), (925, 75))
                row = next(row for row in pair if row["account"] == account)
                deleted = self.request(f"/api/transactions/{row['id']}", "DELETE")
                self.assertEqual(deleted["status"], 200)
                data = json.loads(deleted["body"])
                self.assertFalse(any(row["type"] == "Bank Deposit" for row in data["transactions"]))
                self.assertEqual(data["dashboard"]["cash_balance"] + data["dashboard"]["bank_balance"], 1000)

    def test_failed_transfer_rolls_back_even_when_direct_caller_catches_error(self):
        with app.db() as conn:
            conn.execute("CREATE TRIGGER fail_transfer BEFORE INSERT ON transactions WHEN NEW.account='Bank' BEGIN SELECT RAISE(ABORT,'fixture counterpart failure'); END")
            app.insert_transaction(conn, {"txn_date": "2026-10-23", "type": "Other Income", "amount": 1000})
            with self.assertRaisesRegex(app.sqlite3.IntegrityError, "counterpart failure"):
                app.insert_transaction(conn, {"txn_date": "2026-10-23", "type": "Bank Deposit", "amount": 100})
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM transactions").fetchone()["n"], 1)
        data = json.loads(self.request("/api/bootstrap")["body"])
        self.assertEqual(data["dashboard"]["cash_balance"], 1000)
        self.assertEqual(data["dashboard"]["bank_balance"], 0)

    def test_transfer_upgrade_repairs_legacy_rows_once_and_keeps_existing_pairs(self):
        with app.db() as conn:
            conn.execute("DELETE FROM app_meta WHERE key='balanced_transfers_v1'")
            conn.execute("DROP INDEX transaction_transfer_account")
            conn.execute("ALTER TABLE transactions DROP COLUMN transfer_id")
            conn.executemany("INSERT INTO transactions(txn_date,type,amount,account) VALUES ('2026-10-22',?,?,?)", [
                ("Bank Deposit", 100, "Cash"), ("Bank Withdraw", 25, "Cash"), ("Bank Withdraw", 25, "Bank")])
        app.init_db(auto_sync=False)
        data = json.loads(self.request("/api/bootstrap")["body"])
        self.assertEqual(len(data["transactions"]), 4)
        self.assertEqual((data["dashboard"]["cash_balance"], data["dashboard"]["bank_balance"]), (-75, 75))
        app.init_db(auto_sync=False)
        self.assertEqual(len(json.loads(self.request("/api/bootstrap")["body"])["transactions"]), 4)

    def test_cross_origin_changes_and_form_posts_blocked(self):
        result = self.request("/api/customers", "POST", {"name": "Bad origin"}, origin="https://other.example")
        self.assertEqual(result["status"], 403)
        result = self.request("/api/customers", "POST", content_type="text/plain")
        self.assertEqual(result["status"], 415)
        names = [c["name"] for c in json.loads(self.request("/api/bootstrap")["body"])["customers"]]
        self.assertNotIn("Bad origin", names)

    def test_bad_and_large_bodies_and_reset_do_not_change_data(self):
        self.assertEqual(self.request("/api/customers", "POST", raw=b'[]')["status"], 400)
        self.assertEqual(self.request("/api/customers", "POST", raw=b'{bad')["status"], 400)
        self.assertEqual(self.request("/api/customers", "POST", length=app.MAX_REQUEST_BYTES + 1)["status"], 413)
        self.assertEqual(self.request("/api/reset?confirm=yes", "DELETE")["status"], 403)
        self.assertTrue(app.DB_PATH.exists())
        self.assertEqual(len(json.loads(self.request("/api/bootstrap")["body"])["products"]), 60)

    def test_head_export_and_no_static_path_escape(self):
        result = self.request("/", "HEAD")
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["body"], b"")
        self.assertGreater(int(result["headers"]["Content-Length"]), 0)
        result = self.request("/api/export")
        self.assertEqual(result["status"], 200)
        self.assertIn("attachment", result["headers"]["Content-Disposition"])
        self.assertEqual(self.request("/static/../data/dealership.db")["status"], 403)
        self.assertEqual(self.request("/static/missing.js")["status"], 404)

    def test_wrong_password_and_brute_force_limit(self):
        for attempt in range(10):
            self.assertEqual(self.request("/api/bootstrap", password="wrong")["status"], 401)
        response = self.request("/api/bootstrap", password="wrong")
        self.assertEqual(response["status"], 429)
        self.assertIn("Retry-After", response["headers"])

    def test_production_refuses_missing_or_weak_password(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(ValueError):
                create_application()
            self.assertIsNone(load_access(self.data_dir, required=False))
        with patch.dict(os.environ, {"DEALERSHIP_PASSWORD": "short"}):
            with self.assertRaises(ValueError):
                create_application()

    def test_local_password_hash_and_malformed_authorization(self):
        record = password_record("owner", TEST_PASSWORD)
        self.assertNotIn(TEST_PASSWORD, json.dumps(record))
        (self.data_dir / "access.json").write_text(json.dumps(record))
        with patch.dict(os.environ, {}, clear=True):
            control = load_access(self.data_dir, required=True)
        self.assertIsInstance(control, AccessControl)
        for header in ("Bearer xyz", "Basic !!!", "Basic /w==", "invalid"):
            self.assertEqual(control.verify(header, "test"), 401)
        token = base64.b64encode(f"owner:{TEST_PASSWORD}".encode()).decode()
        self.assertEqual(control.verify("Basic " + token, "test"), 200)


if __name__ == "__main__":
    unittest.main()
