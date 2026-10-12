"""SSA Bridge reference client for Python 3.8+. Standard library only.

    from ssa_bridge_client import connect, discover

    where = discover(server_dir=r"C:\\SCUM-Server")      # a bridge on this machine
    bridge = connect(**where, caller="my-tool")
    r = bridge.query("live", "players")
    print(r["result"] if r["ok"] else (r["code"], r["reason"]))

One connection, kept open, every request multiplexed over it by `id`. Requests never raise for a
refusal: they return {"ok": False, "code": ..., "reason": ...}. Events arrive on `on_event`.
Protocol: https://scumsa.com/docs/dev/ssa-bridge-protocol
"""

import json
import os
import re
import socket
import threading
import time

MAX_REPLY_BYTES = 8 * 1024 * 1024
RETRYABLE = {"rate_limited"}  # `busy` arrives with id "0", so it cannot be matched to a request
# Codes the bridge itself sends in `error`. Anything else there is a module's own sentence.
BRIDGE_CODES = {
    "bad json", "unknown action", "unauthorized", "remote_disabled", "bad_token", "wrong_instance",
    "rate_limited", "busy", "line_too_long", "too_many_clients", "tampered", "unknown_module",
    "unknown_command", "no_data", "missing_config", "missing_command", "missing item", "missing text",
    "missing command", "missing_xy", "bad_xy", "bad_xyz", "no_ground", "no ground below that height",
    "no_executor", "player not ready", "console_failed", "console_refused", "bad channel",
    "too_many_spawns", "no position", "reply_too_long", "reply_too_large", "unlicensed",
}
ADMIN_ACTIONS = {"cmd", "spawn", "batch"}


class BridgeError(Exception):
    """Raised by connect() only, when there is no usable connection."""

    def __init__(self, code, reason):
        super().__init__(reason)
        self.code = code
        self.reason = reason


def bare_command(command):
    """One leading '#' removed: it is the chat prefix, and the bridge wants the bare verb."""
    return re.sub(r"^\s*#", "", str(command or "")).strip()


def to_reply(msg):
    if msg.get("ok") is True:
        out = {"ok": True, "result": msg.get("result")}
        for k in ("changed", "note", "reach"):
            if k in msg:
                out[k] = msg[k]
        return out
    err = str(msg.get("error", "unknown"))
    if err in BRIDGE_CODES:
        out = {"ok": False, "code": err, "reason": str(msg.get("reason") or err)}
    else:
        out = {"ok": False, "code": str(msg.get("reasonCode") or "module_refused"), "reason": err}
    if msg.get("reasonCode"):
        out["reasonCode"] = str(msg["reasonCode"])
    if "reach" in msg:
        out["reach"] = msg["reach"]
    return out


class BridgeClient:
    def __init__(self, sock, instance=None, caller=None, timeout=20.0, backoff=1.0, retries=3):
        self._sock = sock
        self._instance = instance
        self._caller = caller
        self._timeout = timeout
        self._backoff = backoff
        self._retries = retries
        self._seq = 0
        self._lock = threading.Lock()
        self._admin = threading.Lock()   # one admin command on the wire at a time
        self._wlock = threading.Lock()   # one line written at a time
        self._pending = {}
        self._closed = False
        self.status = {}
        self.protocol = 1
        self.on_event = None             # callable(dict), called on the reader thread
        self.on_stray = None             # callable(object), a line with an id we never sent
        self._reader = threading.Thread(target=self._read, daemon=True)
        self._reader.start()

    def _read(self):
        buf = b""
        try:
            while True:
                chunk = self._sock.recv(65536)
                if not chunk:
                    break
                buf += chunk
                if len(buf) > MAX_REPLY_BYTES and b"\n" not in buf:
                    break
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    line = line.rstrip(b"\r")
                    if line.strip():
                        self._dispatch(line)
        except OSError:
            pass
        self._closed = True
        with self._lock:
            waiting, self._pending = self._pending, {}
        for slot in waiting.values():
            slot["msg"] = {"ok": False, "error": "closed", "reason": "the connection closed before the reply arrived", "_client": True}
            slot["done"].set()

    def _dispatch(self, line):
        try:
            msg = json.loads(line.decode("utf-8"))
        except ValueError:
            if self.on_stray:
                self.on_stray(line)
            return
        if isinstance(msg, dict) and "event" in msg and "id" not in msg:
            if self.on_event:
                self.on_event(msg)
            return
        with self._lock:
            slot = self._pending.pop(str(msg.get("id")) if isinstance(msg, dict) else None, None)
        if slot is None:
            if self.on_stray:
                self.on_stray(msg)
            return
        slot["msg"] = msg
        slot["done"].set()

    def _send(self, action, fields):
        if self._closed:
            return {"ok": False, "error": "closed", "reason": "the connection is closed", "_client": True}
        with self._lock:
            self._seq += 1
            rid = str(self._seq)
            slot = {"done": threading.Event(), "msg": None}
            self._pending[rid] = slot
        req = {"id": rid, "action": action}
        req.update(fields or {})
        if self._instance:
            req["instance"] = self._instance
        if self._caller and "caller" not in req:
            req["caller"] = self._caller
        with self._wlock:
            self._sock.sendall((json.dumps(req) + "\n").encode("utf-8"))
        if not slot["done"].wait(self._timeout):
            with self._lock:
                self._pending.pop(rid, None)
            # A request over the bridge's rate budget is queued, not refused: silence is not "no".
            return {"ok": False, "error": "timeout", "reason": "no reply in time; the request may still run", "_client": True}
        return slot["msg"]

    def request(self, action, fields=None):
        """Any action. Waits and sends again on `rate_limited`. Never raises for a refusal."""
        def run():
            attempt = 0
            while True:
                msg = self._send(action, fields)
                if msg.get("ok") is False and msg.get("error") in RETRYABLE and attempt < self._retries:
                    attempt += 1
                    time.sleep(self._backoff * attempt)
                    continue
                break
            if msg.get("_client"):
                return {"ok": False, "code": msg["error"], "reason": msg["reason"]}
            return to_reply(msg)
        if action in ADMIN_ACTIONS:
            with self._admin:
                return run()
        return run()

    def query(self, module, what):
        return self.request("module_data", {"module": module, "what": what})

    def command(self, module, what):
        return self.request("module_command", {"module": module, "what": what})

    def configure(self, module, config):
        return self.request("module_config", {"module": module, "config": config})

    def modules(self):
        return self.request("modules")

    def players(self):
        return self.request("players")

    def cmd(self, command, executor=None, hide=None):
        fields = {"command": bare_command(command)}
        if executor is not None:
            fields["executor"] = executor
        if hide is not None:
            fields["hide"] = hide
        return self.request("cmd", fields)

    def chat(self, text, channel=None, targets=None, exclude=None):
        fields = {"text": str(text)}
        for k, v in (("channel", channel), ("targets", targets), ("exclude", exclude)):
            if v is not None:
                fields[k] = v
        return self.request("chat", fields)

    def subscribe(self, events):
        return self.request("subscribe", {"events": list(events)})

    def close(self):
        self._closed = True
        try:
            self._sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self._sock.close()


def connect(port, host="127.0.0.1", token=None, instance=None, caller=None,
            timeout=20.0, backoff=1.0, retries=3, min_protocol=1, **_ignored):
    """One connection: `auth` first when a token is given, then `status`. Raises BridgeError only
    when there is no usable connection."""
    if not isinstance(port, int) or port <= 0:
        raise BridgeError("no_port", "no port: read it from SSABridge.status.json or ask the owner")
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except OSError as e:
        raise BridgeError("closed", str(e))
    sock.settimeout(None)
    c = BridgeClient(sock, instance=instance, caller=caller, timeout=timeout, backoff=backoff, retries=retries)

    def fail(r):
        c.close()
        raise BridgeError(r["code"], r["reason"])

    if token:
        a = c.request("auth", {"token": token})
        if not a["ok"]:
            fail(a)
    st = c.request("status")
    if not st["ok"]:
        fail(st)
    c.status = st["result"] or {}
    p = c.status.get("protocol")
    c.protocol = p if isinstance(p, int) else 1
    if c.protocol < min_protocol:
        fail({"code": "protocol", "reason": "this bridge speaks protocol %d; %d or newer is needed" % (c.protocol, min_protocol)})
    return c


def discover(server_dir=None, status_file=None):
    """A bridge on this machine, from the file it writes after binding. None when there is no file:
    that bridge has never listened, and whatever answers on 27717 may be another server's."""
    f = status_file or (server_dir and os.path.join(
        server_dir, "SCUM", "Binaries", "Win64", "Mods", "SSABridge", "SSABridge.status.json"))
    if not f:
        return None
    try:
        with open(f, encoding="utf-8") as fh:
            s = json.load(fh)
    except (OSError, ValueError):
        return None
    if not isinstance(s, dict) or not isinstance(s.get("port"), int) or s["port"] <= 0:
        return None
    host = s.get("host") if s.get("host") not in (None, "", "0.0.0.0") else "127.0.0.1"
    return {"host": host, "port": s["port"], "instance": s.get("instance") or None}
