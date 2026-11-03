"""Production WSGI transport; keeps the existing routes and SQLite calculations."""

from email.message import Message
from http import HTTPStatus
from io import BytesIO
import logging

import app
from access import load_access


class WSGIRequest(app.AppRoutes):
    def __init__(self, environ, access):
        self.access = access
        self.command = environ["REQUEST_METHOD"]
        self.path = environ.get("PATH_INFO", "/")
        if environ.get("QUERY_STRING"):
            self.path += "?" + environ["QUERY_STRING"]
        self.headers = Message()
        for name, value in environ.items():
            if name.startswith("HTTP_"):
                self.headers[name[5:].replace("_", "-")] = value
        for name in ("CONTENT_TYPE", "CONTENT_LENGTH"):
            if name in environ:
                self.headers[name.replace("_", "-")] = environ[name]
        self.rfile = environ["wsgi.input"]
        self.wfile = BytesIO()
        self.address = environ.get("REMOTE_ADDR", "unknown")
        self.status = 200
        self.response_headers = list(app.SECURITY_HEADERS.items())

    def address_string(self):
        return self.address

    def send_response(self, status):
        self.status = status

    def send_header(self, name, value):
        self.response_headers.append((name, value))

    def end_headers(self):
        pass

    def send_error(self, status):
        self.json_response(status, {"error": HTTPStatus(status).phrase})


def create_application():
    # Production always requires credentials, regardless of the listening address.
    access = load_access(app.DATA_DIR, required=True)
    app.init_db(auto_sync=False)

    def application(environ, start_response):
        request = WSGIRequest(environ, access)
        try:
            handler = getattr(request, "do_" + request.command, None)
            if handler is None:
                request.send_error(405)
            else:
                handler()
        except Exception:
            logging.exception("Dealership request failed")
            request.status = 500
            request.response_headers = list(app.SECURITY_HEADERS.items())
            request.wfile = BytesIO()
            request.json_response(500, {"error": "Server error. Please try again."})
        start_response(
            f"{request.status} {HTTPStatus(request.status).phrase}", request.response_headers,
        )
        return [request.wfile.getvalue()]

    return application


# Gunicorn loads the factory with `wsgi:create_application()`.
