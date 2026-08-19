#!/usr/bin/env python3
"""HTTP sidecar that exposes real Sibyl Memory to Mimir's TypeScript agents.

This process is not a memory implementation. Every read and write goes through
sibyl_memory_client.MemoryClient against a local SQLite file.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

try:
    from sibyl_memory_client import MemoryClient
    from sibyl_memory_client.exceptions import NotFoundError, SibylMemoryError
except ImportError as exc:  # pragma: no cover - install-time failure
    sys.stderr.write(
        "sibyl-memory-client is not installed. Run: pip install -r sibyl/requirements.txt\n"
    )
    raise SystemExit(1) from exc


HOST = os.environ.get("SIBYL_MEMORY_HOST", "127.0.0.1")
PORT = int(os.environ.get("SIBYL_MEMORY_PORT", "8788"))
DB_PATH = os.environ.get("SIBYL_MEMORY_DB", os.path.expanduser("~/.sibyl-memory/memory.db"))

_clients: dict[str, MemoryClient] = {}


def client_for(tenant: str) -> MemoryClient:
    tenant = (tenant or "").strip()
    if not tenant:
        raise ValueError("tenant is required")
    existing = _clients.get(tenant)
    if existing is not None:
        return existing
    memory = MemoryClient.local(DB_PATH, tenant_id=tenant)
    _clients[tenant] = memory
    return memory


def require_str(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be a non-empty string")
    return value


def handle_rpc(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    op = body.get("op")
    tenant = require_str(body, "tenant")
    memory = client_for(tenant)

    if op == "health":
        return 200, {
            "ok": True,
            "engine": "sibyl-memory-client",
            "db": str(memory.storage.db_path),
            "tenant": memory.get_tenant(),
            "schema_version": memory.schema_version(),
        }

    if op == "get_entity":
        category = require_str(body, "category")
        name = require_str(body, "name")
        try:
            entity = memory.get_entity(category, name)
        except NotFoundError:
            return 404, {"ok": False, "error": "not_found"}
        return 200, {"ok": True, "entity": entity}

    if op == "set_entity":
        category = require_str(body, "category")
        name = require_str(body, "name")
        payload = body.get("body")
        if not isinstance(payload, (dict, list)):
            raise ValueError("body must be a JSON object or array")
        entity = memory.set_entity(category, name, payload)
        return 200, {"ok": True, "entity": entity}

    if op == "write_event":
        event_id = memory.write_event(
            evaluated=body.get("evaluated"),
            acted=body.get("acted"),
            extra=body.get("extra"),
        )
        return 200, {"ok": True, "id": event_id}

    if op == "read_events":
        limit = body.get("limit", 50)
        events = memory.read_events(limit=limit)
        return 200, {"ok": True, "events": events}

    if op == "get_state":
        key = require_str(body, "key")
        state = memory.get_state(key)
        if state is None:
            return 404, {"ok": False, "error": "not_found"}
        return 200, {"ok": True, "state": state}

    if op == "set_state":
        key = require_str(body, "key")
        payload = body.get("body")
        if not isinstance(payload, (dict, list)):
            raise ValueError("body must be a JSON object or array")
        memory.set_state(key, payload)
        return 200, {"ok": True}

    if op == "search_entities":
        query = require_str(body, "query")
        results = memory.search_entities(query)
        return 200, {"ok": True, "results": results}

    raise ValueError(f"unknown op: {op!r}")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[sibyl] " + (fmt % args) + "\n")

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/health", "/"):
            try:
                memory = MemoryClient.local(DB_PATH)
                self._send(
                    200,
                    {
                        "ok": True,
                        "engine": "sibyl-memory-client",
                        "db": str(memory.storage.db_path),
                        "schema_version": memory.schema_version(),
                    },
                )
            except Exception as exc:
                self._send(500, {"ok": False, "error": str(exc)})
            return
        self._send(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path not in ("/rpc", "/"):
            self._send(404, {"ok": False, "error": "not_found"})
            return
        length = int(self.headers.get("Content-Length", "0"))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            if not isinstance(body, dict):
                raise ValueError("JSON object required")
            status, payload = handle_rpc(body)
            self._send(status, payload)
        except SibylMemoryError as exc:
            self._send(400, {"ok": False, "error": str(exc)})
        except ValueError as exc:
            self._send(400, {"ok": False, "error": str(exc)})
        except Exception as exc:
            traceback.print_exc()
            self._send(500, {"ok": False, "error": str(exc)})


def main() -> None:
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)) or ".", exist_ok=True)
    # Open once so a missing install or a broken schema fails at boot, not
    # on the first agent call.
    MemoryClient.local(DB_PATH)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    sys.stderr.write(f"[sibyl] MemoryClient on {HOST}:{PORT} db={DB_PATH}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
