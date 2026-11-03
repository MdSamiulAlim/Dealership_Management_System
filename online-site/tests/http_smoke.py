"""Use only against the portable preview; verifies real auth and D1 APIs."""

from http.cookiejar import CookieJar
import json
import os
from urllib.error import HTTPError
from urllib.request import build_opener, HTTPCookieProcessor, Request

BASE = "http://127.0.0.1:5173"
client = build_opener(HTTPCookieProcessor(CookieJar()))
test_authorization = os.environ.get("APP_TEST_AUTHORIZATION")


def request(path, method="GET", payload=None, origin=None, authorized=True):
    headers = {"Content-Type": "application/json"}
    if test_authorization and authorized:
        headers["Authorization"] = test_authorization
    if origin:
        headers["Origin"] = origin
    req = Request(BASE + path, data=json.dumps(payload).encode() if payload is not None else None,
                  headers=headers, method=method)
    try:
        response = client.open(req, timeout=30)
    except HTTPError as error:
        response = error
    with response:
        return response.status, {k.lower(): v for k, v in response.headers.items()}, response.read()


def main():
    if not test_authorization:
        raise SystemExit("Configure disposable app credentials for the local preview and set APP_TEST_AUTHORIZATION, or run tests/built_login.py instead.")
    assert request("/api/bootstrap", authorized=False)[0] == 401
    status, _, body = request("/")
    assert status == 200 and b"Arafat Traders" in body
    status, _, body = request("/api/bootstrap")
    data = json.loads(body)
    assert status == 200 and len(data["products"]) == 60
    assert len([p for p in data["products"] if p["default_rate"] > 0]) == 42
    status, _, body = request("/api/customers", "POST", {"name": "Temporary integration customer", "opening_due": 150}, origin=BASE)
    assert status == 201
    customer = next(c for c in json.loads(body)["customers"] if c["name"] == "Temporary integration customer")
    try:
        second = build_opener(HTTPCookieProcessor(CookieJar()))
        second.addheaders = [("Authorization", test_authorization)]
        with second.open(BASE + "/api/bootstrap", timeout=30) as response:
            assert any(c["id"] == customer["id"] for c in json.loads(response.read())["customers"])
        assert request("/api/customers", "POST", {"name": "Blocked origin"}, origin="https://other.example")[0] == 403
    finally:
        status, _, body = request("/api/customers/" + str(customer["id"]), "DELETE", origin=BASE)
        assert status == 200 and not any(c["id"] == customer["id"] for c in json.loads(body)["customers"])
    status, headers, body = request("/api/export")
    assert status == 200 and "attachment" in headers["content-disposition"]
    assert len(json.loads(body)["products"]) == 60
    status, _, body = request("/dealership.js")
    assert status == 200 and b"function bindEvents" in body
    print("PASS: actual Vinext/D1 routes, password-only login, page, all prices, two device saves, CSRF, delete, export and browser script.")


if __name__ == "__main__":
    main()
