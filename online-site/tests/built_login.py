"""Test the built Worker with disposable login credentials, on loopback only."""

import argparse
import base64
import json
import hashlib
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from worker_http import WorkerHttpClient, assert_login_page, wait_for_worker


def main(artifacts_dir=None):
    password = "test-only-worker-password"
    salt = secrets.token_bytes(16)
    record = "pbkdf2-sha256$100000$" + salt.hex() + "$" + hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000).hex()
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    temporary = tempfile.TemporaryDirectory(prefix="arafat-built-auth-")
    database_path = str(Path(temporary.name) / "db")
    environment = dict(os.environ, SITES_RUNTIME_ROOT=str(Path(temporary.name) / "runtime"), XDG_CONFIG_HOME=str(Path(temporary.name) / "config"))
    for migration in sorted(Path("drizzle").glob("*.sql")):
        subprocess.run([shutil.which("node"), "--import", "./scripts/sites-env.mjs", "./node_modules/wrangler/bin/wrangler.js",
                        "d1", "execute", "DB", "--local", "--config", "dist/server/wrangler.json", "--persist-to", database_path,
                        "--file", str(migration)], env=environment, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    # Serve an immutable copy: source edits, diagnostics and another build must
    # not trigger Wrangler's development watcher during a regression run.
    artifact = Path(temporary.name) / "artifact"
    shutil.copytree("dist", artifact)
    (artifact / "package.json").write_text('{"private":true,"type":"module"}')
    worker_log = tempfile.TemporaryFile()
    process = subprocess.Popen([shutil.which("node"), "tests/serve-built-worker.mjs"], env=environment,
                               stdin=subprocess.PIPE, stdout=worker_log, stderr=subprocess.STDOUT)
    process.stdin.write(json.dumps({"config": str(artifact / "server/wrangler.json"), "persistTo": database_path,
                                    "port": port, "vars": {"APP_LOGIN_USERNAME": "TestOwner", "APP_LOGIN_PASSWORD_RECORD": record, "APP_GENERAL_USERNAME":"TestStaff", "APP_GENERAL_PASSWORD_RECORD":record}}).encode())
    process.stdin.close()
    base = f"http://127.0.0.1:{port}"
    token = base64.b64encode(("TestOwner:" + password).encode()).decode()

    artifacts = artifacts_dir or Path("outputs/http-tests") / str(uuid.uuid4())
    client = WorkerHttpClient(base, artifacts)
    request = client.request

    try:
        wait_for_worker(client, process)
        for method, path in [("GET", "/api/bootstrap"), ("GET", "/api/export"),
                             ("HEAD", "/api/bootstrap"), ("GET", "/api/sales/1"), ("PATCH", "/api/sales/1"), ("GET", "/api/sales/1/receipt"), ("HEAD", "/api/sales/1/receipt"), ("POST", "/api/customers"),
                             ("PATCH", "/api/products/1"), ("DELETE", "/api/products/1")]:
            status, headers, body = request(path, method)
            assert status == 401 and "no-store" in headers.get("Cache-Control", "") and not headers.get("WWW-Authenticate"), (method, path, status, body[:500])
        assert_login_page(request("/"))
        # MCP discovery is public metadata; cloud backup execution requires
        # the Sites-verified owner and never accepts the business app cookie.
        status, _, mcp_body = request('/mcp', 'POST', payload={'jsonrpc':'2.0','id':1,'method':'tools/list'})
        assert status == 200 and any(tool['name']=='run_daily_backup' for tool in json.loads(mcp_body)['result']['tools'])
        status, _, _ = request('/mcp', 'POST', payload={'jsonrpc':'2.0','id':2,'method':'tools/call','params':{'name':'run_daily_backup','arguments':{}}})
        assert status == 403
        _, _, startup_html = request("/")
        assert b'<script defer src="/offline-store.js?v=percentage-half-up-2026-v1"' in startup_html
        assert b'_next/static/' not in startup_html and b'__next_f' not in startup_html
        assert request("/api/bootstrap", authorization="Basic " + base64.b64encode(b"TestOwner:wrong").decode())[0] == 401
        authorization = "Basic " + token
        status, health_headers, health_body = request("/healthz")
        assert status == 200 and json.loads(health_body)["status"] == "ok"
        for path in ["/", "/api/bootstrap", "/offline-store.js"]:
            asset_status, protected_headers, asset_body = request(path)
            assert asset_status == (401 if path == "/api/bootstrap" else 200), (path, asset_status)
            if path == "/offline-store.js": assert b"window.WorkspaceStore" in asset_body
            assert protected_headers.get("X-Content-Type-Options") == "nosniff", (path, dict(protected_headers))
            assert protected_headers.get("X-Frame-Options") == "DENY", (path, dict(protected_headers))
            assert protected_headers.get("Content-Security-Policy"), path
        status, _, start_body = request("/api/replica/start", authorization=authorization)
        assert status == 200 and json.loads(start_body)["protocol"] == 2
        replica = json.loads(start_body)
        status, _, packed_body = request("/api/replica/start?packed=1", authorization=authorization)
        assert status == 200 and len(packed_body) < 128 * 1024
        packed = json.loads(packed_body)["initial_page"]
        assert packed["done"] is True and any(group["entity"]=="products" and len(group["rows"])>0 for group in packed["groups"])
        status, _, rows_body = request("/api/replica/rows?entity=products&epoch=0", authorization=authorization)
        assert status == 200 and len(rows_body) < 128 * 1024
        status, _, delta_body = request("/api/replica/changes?after=" + str(replica["sync_revision"]) + "&epoch=0", authorization=authorization)
        assert status == 200 and json.loads(delta_body)["changes"] == []
        status, _, audit_body = request("/api/admin/audit", authorization=authorization)
        assert status == 200 and isinstance(json.loads(audit_body)["rows"], list)
        staff = "Basic " + base64.b64encode(("TestStaff:" + password).encode()).decode()
        for protected in ["/api/admin/audit", "/api/admin/operations"]:
            assert request(protected, authorization=staff)[0] == 403
        for path in ['/api/admin/backups/daily', '/api/admin/backup-schedule']:
            assert request(path, 'POST', authorization=staff, payload={})[0] == 403
        status, _, daily_body = request('/api/admin/backups/daily', 'POST', authorization=authorization, payload={})
        assert status == 200 and json.loads(daily_body)['status'] == 'succeeded'
        status, _, repeated_body = request('/api/admin/backups/daily', 'POST', authorization=authorization, payload={})
        assert status == 200 and json.loads(repeated_body)['replayed'] is True and json.loads(repeated_body)['backup_id'] == json.loads(daily_body)['backup_id']
        assert request("/api/admin/backups", "POST", authorization=staff, payload={})[0] == 403
        status, _, backup_body = request("/api/admin/backups", "POST", authorization=authorization, payload={})
        assert status == 201, (status, backup_body[:500])
        backup = json.loads(backup_body)
        status, backup_headers, content = request("/api/admin/backups/" + backup["id"], authorization=authorization)
        assert status == 200 and hashlib.sha256(content).hexdigest() == backup["sha256"] == backup_headers.get("X-Backup-SHA256")
        assert json.loads(content)["format"] == "arafat-cloud-backup-v1"
        status, _, metrics_body = request("/api/admin/operations", authorization=authorization)
        assert status == 200 and json.loads(metrics_body)["cloud_backup"] is True
        status, login_headers, login_body = request("/api/login", "POST", payload={"username": "TestOwner", "password": password})
        assert status == 200 and json.loads(login_body)["user"]["role"] == "admin"
        session = login_headers["Set-Cookie"].split(";", 1)[0]
        assert request("/api/bootstrap", extra_headers={"Cookie": session})[0] == 200
        second_status, second_headers, _ = request('/api/login', 'POST', payload={'username': 'TestOwner', 'password': password})
        assert second_status == 200
        other_session = second_headers['Set-Cookie'].split(';', 1)[0]
        status, logout_headers, _ = request("/api/logout", "POST", extra_headers={"Cookie": session})
        assert status == 200
        assert request('/api/bootstrap', extra_headers={'Cookie': session})[0] == 401
        assert request('/api/bootstrap', extra_headers={'Cookie': other_session})[0] == 200
        assert request("/api/bootstrap", authorization=authorization, extra_headers={"Cookie": logout_headers["Set-Cookie"].split(";", 1)[0]})[0] == 401
        assert request("/", authorization=authorization)[0] == 200
        assert request("/api/bootstrap", authorization=authorization)[0] == 200
        assert request("/api/export", authorization=authorization)[0] == 200
        assert request("/api/bootstrap", identity=True)[0] == 401
        assert request("/api/bootstrap", extra_headers={"x-middleware-subrequest": "middleware:middleware:middleware:middleware:middleware"})[0] == 401
        assert request("/api/bootstrap", authorization=authorization, identity=False)[0] == 200
        assert request("/api/customers", "POST", authorization, origin="https://other.example")[0] == 403
        _, _, bootstrap_body = request("/api/bootstrap", authorization=authorization)
        local_data = json.loads(bootstrap_body)
        product = local_data["products"][0]
        def command(method, path, payload, operation=None):
            return request("/api/commands", "POST", authorization, payload={"id": operation or str(uuid.uuid4()), "method": method, "path": path, "payload": payload})
        status, _, body = command("POST", "/api/adjustments", {"adjust_date": "2026-10-21", "product_id": product["id"], "type": "Manual Add", "quantity": 20, "confirmed": True})
        assert status == 200, (status, body[:500])
        compact_id = str(uuid.uuid4())
        compact_command = {"id":compact_id,"method":"POST","path":"/api/customers","payload":{"name":"Compact protocol customer"}}
        status, _, compact_body = request("/api/commands", "POST", authorization, extra_headers={"X-Workspace-Protocol":"2"}, payload=compact_command)
        compact = json.loads(compact_body)
        assert status == 200 and compact["sync_protocol"] == 2 and "sales" not in compact and len(compact_body)<1000
        status, _, actor_body = request("/api/admin/audit?actor=TestOwner&entity=customers", authorization=authorization)
        assert status == 200 and any(row["operation_id"]==compact_id and row["actor_role"]=="admin" for row in json.loads(actor_body)["rows"])
        for case in json.loads(Path("tests/invalid-records.json").read_text()):
            payload = json.loads(json.dumps(case["payload"]).replace('"$product"', str(product["id"])).replace('"$customer"', str(local_data["customers"][0]["id"])))
            status, _, bad_body = request("/api/" + case["entity"], "POST", authorization, payload=payload)
            assert status == 400, (case, status, bad_body[:500])
            if case["entity"] != "sales":
                status, _, bad_body = command("POST", "/api/" + case["entity"], payload)
                assert status == 400, (case, status, bad_body[:500])
        _, _, before_body = request("/api/bootstrap", authorization=authorization)
        before = json.loads(before_body)
        current_product = next(p for p in before["products"] if p["id"] == product["id"])
        patch = {"default_rate": 500, "original": current_product}
        assert request(f"/api/products/{product['id']}", "PATCH", authorization, payload={"default_rate": 500})[0] == 409
        assert request(f"/api/products/{product['id']}", "PATCH", authorization, payload=patch)[0] == 200
        assert request(f"/api/products/{product['id']}", "PATCH", authorization, payload={**patch, "default_rate": 100})[0] == 409
        _, _, verify_body = request("/api/bootstrap", authorization=authorization)
        assert next(p for p in json.loads(verify_body)["products"] if p["id"] == product["id"])["default_rate"] == 500
        status, _, customer_body = request("/api/customers", "POST", authorization, payload={"name": "Payment parent regression"})
        assert status == 201
        customer = next(c for c in json.loads(customer_body)["customers"] if c["name"] == "Payment parent regression")
        assert request("/api/payments", "POST", authorization, extra_headers={"X-Operation-ID": str(uuid.uuid4())}, payload={"customer_id": customer["id"], "payment_date": "2026-10-21", "amount": 100, "account": "Cash"})[0] == 201
        assert request(f"/api/customers/{customer['id']}", "DELETE", authorization)[0] == 409
        assert command("DELETE", f"/api/customers/{customer['id']}", {"original": customer, "confirmed": True})[0] == 409
        _, _, verify_body = request("/api/bootstrap", authorization=authorization)
        assert json.loads(verify_body)["dashboard"]["cash_balance"] == before["dashboard"]["cash_balance"] + 100
        status, _, product_body = request("/api/products", "POST", authorization, payload={"name": "Order parent regression"})
        assert status == 201
        order_product = next(p for p in json.loads(product_body)["products"] if p["name"] == "Order parent regression")
        assert request("/api/orders", "POST", authorization, payload={"product_id": order_product["id"], "order_date": "2026-10-21", "quantity": 10, "rate": 100, "status": "Delivered"})[0] == 201
        assert request(f"/api/products/{order_product['id']}", "DELETE", authorization)[0] == 409
        assert command("DELETE", f"/api/products/{order_product['id']}", {"original": order_product, "confirmed": True})[0] == 409
        _, _, verify_body = request("/api/bootstrap", authorization=authorization)
        assert json.loads(verify_body)["dashboard"]["company_payable"] == before["dashboard"]["company_payable"] + 1000
        oversale = {"sale_date": "2026-10-21", "customer_id": customer["id"], "product_id": product["id"], "quantity": 100, "rate": 100}
        assert request("/api/sales", "POST", authorization, payload=oversale)[0] == 409
        assert command("POST", "/api/invoices", {"id": str(uuid.uuid4()), "sale_date": "2026-10-21", "customer_id": customer["id"], "items": [{"product_id": product["id"], "quantity": 100, "rate": 100}]})[0] == 409
        status, _, body = request("/api/sales", "POST", authorization, payload={"sale_date": "2026-10-18", "customer_id": local_data["customers"][0]["id"], "product_id": local_data["products"][0]["id"], "quantity": 2, "rate": 1234.5, "paid_amount": 1000, "account": "Cash", "notes": "বাংলা রসিদ পরীক্ষা"})
        assert status == 201, (status, body[:500])
        saved = json.loads(body)["sales"][0]
        sale_id = saved["id"]
        try:
            status, _, body = request(f"/api/sales/{sale_id}", authorization=authorization)
            assert status == 200
            original = json.loads(body)
            updated = {**original, "quantity": 3, "rate": 1000, "paid_amount": 1500, "account": "Bank", "original": original}
            assert request(f"/api/sales/{sale_id}", "PATCH", authorization, origin="https://other.example", payload=updated)[0] == 403
            status, _, body = request(f"/api/sales/{sale_id}", "PATCH", authorization, payload=updated)
            assert status == 409, (status, body[:500])
            invoice_id = "legacy-" + str(sale_id)
            def command(method, path, payload, operation=None):
                return request("/api/commands", "POST", authorization, payload={"id": operation or str(uuid.uuid4()), "method": method, "path": path, "payload": payload})
            update_invoice = {"expected_version": 1, "sale_date": original["sale_date"], "customer_id": original["customer_id"],
                              "items": [{"product_id": original["product_id"], "quantity": 3, "rate": 1000}], "paid_amount": 1500, "account": "Bank"}
            operation = str(uuid.uuid4())
            status, _, body = command("PATCH", f"/api/invoices/{invoice_id}", update_invoice, operation)
            assert status == 200, (status, body[:500])
            edited = next(invoice for invoice in json.loads(body)["invoices"] if invoice["id"] == invoice_id)
            assert edited["total_amount"] == 3000 and edited["due_amount"] == 1500 and edited["account"] == "Bank"
            assert command("PATCH", f"/api/invoices/{invoice_id}", update_invoice, operation)[0] == 200
            assert command("PATCH", f"/api/invoices/{invoice_id}", update_invoice)[0] == 409
            sale_id = edited["items"][0]["sale_id"]
            status, _, body = request(f"/api/sales/{sale_id}", authorization=authorization)
            assert status == 200 and json.loads(body)["quantity"] == 3
            status, headers, body = request(f"/api/sales/{sale_id}/receipt", authorization=authorization)
            assert status == 200 and headers.get_content_type() == "application/pdf" and body.startswith(b"%PDF-"), (status, body[:500])
            assert "Arafat-Traders-Memo" in headers["Content-Disposition"]
            assert "no-store" in headers["Cache-Control"]
            assert request(f"/api/sales/{sale_id}/receipt", "HEAD", authorization)[0] == 200
            assert request("/api/sales/999999999/receipt", authorization=authorization)[0] == 404
            assert request("/api/sales/bad/receipt", authorization=authorization)[0] == 400
            status, headers, body = request(f"/api/invoices/{invoice_id}/receipt", authorization=authorization)
            assert status == 200 and body.startswith(b"%PDF-") and "no-store" in headers["Cache-Control"]
            assert command("DELETE", f"/api/invoices/{invoice_id}", {"expected_version": 2})[0] == 400
            assert command("DELETE", f"/api/invoices/{invoice_id}", {"expected_version": 2, "confirmed": True})[0] == 200
        finally:
            assert request(f"/api/sales/{sale_id}", "DELETE", authorization)[0] == 409
        # Financial legacy callers must supply one stable ID; response loss is
        # reconciled by repeating that same request, never by creating a new ID.
        payment = {'payment_date': '2026-10-23', 'customer_id': local_data['customers'][0]['id'], 'amount': 100, 'account': 'Cash'}
        assert request('/api/payments', 'POST', authorization, payload=payment)[0] == 400
        operation = str(uuid.uuid4())
        first_payment = request('/api/payments', 'POST', authorization, payload=payment, extra_headers={'X-Operation-ID': operation})
        second_payment = request('/api/payments', 'POST', authorization, payload=payment, extra_headers={'X-Operation-ID': operation})
        assert first_payment[0] == 201 and second_payment[0] == 201
        assert len(json.loads(first_payment[2])['payments']) == len(json.loads(second_payment[2])['payments'])
        before_transfer = json.loads(second_payment[2])
        transfer_id = str(uuid.uuid4())
        transfer_result = command('POST', '/api/transactions', {'txn_date': '2026-10-23', 'type': 'Bank Deposit', 'amount': 100, 'account': 'Cash'}, transfer_id)
        assert transfer_result[0] == 200
        after_transfer = json.loads(transfer_result[2])
        assert after_transfer['dashboard']['cash_balance'] == before_transfer['dashboard']['cash_balance'] - 100
        assert after_transfer['dashboard']['bank_balance'] == before_transfer['dashboard']['bank_balance'] + 100
        transfer_rows = [row for row in after_transfer['transactions'] if row.get('transfer_id') == transfer_id]
        assert len(transfer_rows) == 2
        source = next(row for row in transfer_rows if row['account'] == 'Cash')
        deleted = command('DELETE', '/api/transactions/' + str(source['id']), {'original': source, 'confirmed': True})
        assert deleted[0] == 200
        restored = json.loads(deleted[2])
        assert restored['dashboard']['cash_balance'] == before_transfer['dashboard']['cash_balance']
        assert restored['dashboard']['bank_balance'] == before_transfer['dashboard']['bank_balance']
        # A valid write larger than the sync page target must remain readable.
        big_notes=('বাংলা নোট 🌾 "quoted"\n'*6000).strip()
        product_result=request('/api/products','POST',authorization,payload={'name':'Large note fixture','opening_stock':10})
        assert product_result[0]==201
        big_product=next(p for p in json.loads(product_result[2])['products'] if p['name']=='Large note fixture')
        start_status,_,start_body=request('/api/replica/start',authorization=authorization)
        assert start_status==200
        before_revision=json.loads(start_body)['sync_revision']
        big_id=str(uuid.uuid4())
        big_payload={'id':big_id,'invoice_no':'CUSTOM-LARGE-HTTP','sale_date':'2026-10-24','customer_id':customer['id'],'items':[{'product_id':big_product['id'],'quantity':1,'rate':100}],'notes':big_notes,'paid_amount':0,'account':'Cash'}
        saved_big=command('POST','/api/invoices',big_payload)
        assert saved_big[0]==200,(saved_big[0],saved_big[2][:300])
        cursor=before_revision;found_note=False
        while True:
            status,_,delta_body=request('/api/replica/changes?after='+str(cursor)+'&epoch=0',authorization=authorization)
            assert status==200,(status,delta_body[:300])
            delta=json.loads(delta_body)
            if len(delta_body)>128*1024:assert len(delta['changes'])==1
            for event in delta['changes']:
                if event['entity']=='invoices' and event['record_id']==big_id:
                    assert event['data']['notes']==big_notes;found_note=True
            cursor=delta['next_revision']
            if not delta['has_more']:break
        assert found_note
        status,_,packed_body=request('/api/replica/start?packed=1',authorization=authorization)
        assert status==200
        cursor='';found_note=False
        while True:
            status,_,page_body=request('/api/replica/rows?entity=invoices&after='+cursor+'&epoch=0',authorization=authorization)
            assert status==200,(status,page_body[:300])
            page=json.loads(page_body)
            if len(page_body)>128*1024:assert len(page['rows'])==1
            for row in page['rows']:
                if row['id']==big_id:assert row['notes']==big_notes;found_note=True
            if page['done']:break
            cursor=page['next_cursor']
        assert found_note
        big_edit=command('PATCH','/api/invoices/'+big_id,{**big_payload,'invoice_no':'CUSTOM-LARGE-EDITED','expected_version':1})
        assert big_edit[0]==200
        assert next(i for i in json.loads(big_edit[2])['invoices'] if i['id']==big_id)['invoice_no']=='CUSTOM-LARGE-EDITED'
        print('PASS: large UTF-8 notes remain readable across packed/row/delta sync and custom invoice number edits persist.')
        def wrong_login(_):
            req = Request(base + '/api/login', method='POST', data=json.dumps({'username': 'TestOwner', 'password': 'wrong-fixture'}).encode(), headers={'Content-Type': 'application/json', 'CF-Connecting-IP': '198.51.100.19'})
            try:
                with urlopen(req, timeout=30) as response:
                    return response.status
            except HTTPError as error:
                return error.code
        with ThreadPoolExecutor(max_workers=40) as pool:
            statuses = list(pool.map(wrong_login, range(40)))
        assert statuses.count(401) == 10 and statuses.count(429) == 30, statuses
        print('PASS: copied logged-out cookie revoked, second phone session valid, payment retries idempotent, 40 concurrent bad logins return 10 x 401 and 30 x 429.')
        print("PASS: legacy and command HTTP validation contract, parent deletion preserves cash/payable, stale product edits and stock overuse rejected.")
        print("PASS: authenticated multi-item invoice editing, idempotent replay, stale edit protection, confirmed cancellation, PDF downloads and legacy route protection.")
        print("PASS: public login shell, signed login/logout, protected data APIs, forged identity rejection and CSRF checks.")
        print("HTTP_TEST_SUMMARY " + json.dumps({"startup_polls": client.startup_waits, "proxy_events": sum(event.get("reason") in ("miniflare_proxy_disconnect", "worker_restarted") for event in client.history), "transport_events": sum("transport_error" in event for event in client.history), "artifacts": str(artifacts)}))
    except Exception:
        client.save_failure()
        artifacts.mkdir(parents=True, exist_ok=True)
        worker_log.seek(0)
        (artifacts / "worker.log").write_bytes(worker_log.read())
        print(f"HTTP failure evidence: {artifacts}")
        worker_log.seek(0)
        print(worker_log.read().decode(errors="replace")[-8000:])
        raise
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        worker_log.close()
        temporary.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=1, help="Fresh Worker and database for each full test run (1-20).")
    parser.add_argument("--artifacts-dir", type=Path, default=Path("outputs/http-tests") / str(uuid.uuid4()))
    args = parser.parse_args()
    if not 1 <= args.runs <= 20:
        parser.error("--runs must be between 1 and 20")
    for run in range(1, args.runs + 1):
        print(f"HTTP cold-start run {run}/{args.runs}", flush=True)
        main(args.artifacts_dir / str(run))
