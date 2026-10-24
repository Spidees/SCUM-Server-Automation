"""SSA Bridge reference client for Python 3.8+. Standard library only.

    from ssa_bridge_client import connect, discover

    where = discover(server_dir=r"C:\\SCUM-Server")      # a bridge on this machine
    if where is None:
        raise SystemExit("that bridge has never listened: no status file")
    bridge = connect(**where, caller="my-tool")
    r = bridge.query("live", "players")
    print(r["result"] if r["ok"] else (r["code"], r["reason"]))

One connection, kept open, every request multiplexed over it by `id`. Requests never raise for a
refusal: they return {"ok": False, "code": ..., "reason": ...}. Events arrive on `on_event`, called
on a thread of the client's own, never on the one that reads the socket, so a handler may send
requests of its own. A handler that raises is logged to the "ssa_bridge_client" logger.
Protocol: https://scumsa.com/docs/dev/ssa-bridge-protocol
"""

import hashlib
import hmac
import json
import logging
import os
import queue
import re
import socket
import threading
import time

MAX_REPLY_BYTES = 8 * 1024 * 1024
# The longest line the client buffers: the bridge's largest answer, plus room for its envelope.
MAX_LINE_BYTES = MAX_REPLY_BYTES + 64 * 1024
# Refusals the client answers by waiting and sending again. `rate_limited` is a wait the bridge asks
# for. `busy` means the bridge's queue was full and it DROPPED the request without running it, so
# sending it again is safe; it carries the request's own id since bridge 2.44.0. A module that
# refuses with `reasonCode` `busy` is not retried: that refusal is the module's, not the queue's.
RETRYABLE = {"rate_limited", "busy"}
# Codes the bridge itself sends in `error`. Anything else there is a module's own sentence.
# @@BRIDGE_CODES begin: generated from the bridge's source, do not edit by hand
BRIDGE_CODES = {
    "bad json",
    "unknown action",
    "bad_request",
    "control_char",
    "unauthorized",
    "remote_disabled",
    "bad_token",
    "hmac_unavailable",
    "nonce_failed",
    "wrong_instance",
    "rate_limited",
    "busy",
    "line_too_long",
    "too_many_clients",
    "tampered",
    "unknown_module",
    "unknown_command",
    "no_data",
    "missing_config",
    "missing_command",
    "missing item",
    "missing text",
    "missing command",
    "bad_item",
    "bad_rest",
    "missing_xy",
    "bad_xy",
    "bad_xyz",
    "no_ground",
    "no ground below that height",
    "no_executor",
    "nothing_ran",
    "player not ready",
    "console_failed",
    "console_refused",
    "bad channel",
    "bad_targets",
    "bad_exclude",
    "no_frame",
    "too_many_spawns",
    "no position",
    "reply_too_long",
    "reply_too_large",
    "not_found",
    "write_failed",
    "bad_use",
    "bad_class",
    "unknown_class",
    "unlicensed",
}
# @@BRIDGE_CODES end
# Actions that run a SCUM admin command. The client keeps at most one of them on the wire.
ADMIN_ACTIONS = {"cmd", "spawn", "batch"}
# Refusals after which a reconnect would only be refused again.
FATAL_ON_RECONNECT = {"bad_token", "remote_disabled", "tampered", "protocol", "wrong_instance"}

log = logging.getLogger("ssa_bridge_client")


class BridgeError(Exception):
    """Raised by connect() only, when there is no usable connection."""

    def __init__(self, code, reason, reason_code=None, retry_after_ms=None):
        super().__init__(reason)
        self.code = code
        self.reason = reason
        self.reason_code = reason_code
        self.retry_after_ms = retry_after_ms


def bare_command(command):
    """One leading '#' removed: it is the chat prefix, and the bridge wants the bare verb."""
    return re.sub(r"^\s*#", "", str(command or "")).strip()


def _number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


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
    if _number(msg.get("retryAfterMs")):
        out["retryAfterMs"] = msg["retryAfterMs"]
    if "reach" in msg:
        out["reach"] = msg["reach"]
    return out


def is_lockout(msg):
    """`rate_limited` with `reasonCode` `locked_out` is not a wait: too many wrong tokens came from
    this address, the bridge has closed the connection, and resending would only be refused again."""
    return msg.get("reasonCode") == "locked_out"


def _local(code, reason, reason_code=None):
    """A refusal the client made itself: it never reached the bridge, or never came back."""
    m = {"ok": False, "error": code, "reason": reason, "_client": True}
    if reason_code:
        m["reasonCode"] = reason_code
    return m


def _out(msg):
    if msg.get("_client"):
        r = {"ok": False, "code": msg["error"], "reason": msg["reason"]}
        if msg.get("reasonCode"):
            r["reasonCode"] = msg["reasonCode"]
        return r
    return to_reply(msg)


def _keepalive(sock):
    """TCP keepalive, so a link that died without a word is noticed by the system as well."""
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
    except OSError:
        return
    try:
        if hasattr(socket, "SIO_KEEPALIVE_VALS"):
            sock.ioctl(socket.SIO_KEEPALIVE_VALS, (1, 15000, 5000))
            return
        idle = getattr(socket, "TCP_KEEPIDLE", None) or getattr(socket, "TCP_KEEPALIVE", None)
        for opt, v in ((idle, 15), (getattr(socket, "TCP_KEEPINTVL", None), 5), (getattr(socket, "TCP_KEEPCNT", None), 4)):
            if opt is not None:
                sock.setsockopt(socket.IPPROTO_TCP, opt, v)
    except (OSError, ValueError, AttributeError):
        pass


class BridgeClient:
    def __init__(self, sock, instance=None, caller=None, timeout=20.0, backoff=1.0, retries=3,
                 heartbeat=30.0, keepalive=True, reconnect=None, rediscover=None,
                 host="127.0.0.1", port=None, token=None, min_protocol=1):
        self._instance = instance
        self._caller = caller
        self._timeout = timeout
        self._backoff = backoff
        self._retries = retries
        self._heartbeat = heartbeat if _number(heartbeat) and heartbeat > 0 else None
        self._keepalive = keepalive
        if reconnect is True:
            reconnect = (1.0, 30.0)
        self._reconnect = tuple(reconnect) if reconnect else None
        self._rediscover = rediscover
        self._host, self._port, self._token, self._min_protocol = host, port, token, min_protocol
        self._seq = 0
        self._lock = threading.Lock()
        self._admin = threading.Lock()   # one admin command on the wire at a time
        self._wlock = threading.Lock()   # one line written at a time
        self._pending = {}
        self._closed = False             # for good
        self._user_closed = False
        self._reconnecting = False
        self._subs = set()
        self._stop = threading.Event()
        self._sock = None
        self._last_rx = time.monotonic()
        self.close_reason = None
        self.status = {}
        self.protocol = 1
        self.on_event = None             # callable(dict)
        self.on_stray = None             # callable(object), a line with an id we never sent
        self.on_disconnect = None        # callable(dict): the link dropped and a reconnect began
        self.on_reconnect = None         # callable(dict): {"attempt", "status"} once it is back
        self.on_close = None             # callable(): closed for good
        self._queue = queue.Queue()
        threading.Thread(target=self._pump, daemon=True, name="ssa-bridge-pump").start()
        self._attach(sock)
        if self._heartbeat:
            threading.Thread(target=self._beat, daemon=True, name="ssa-bridge-heartbeat").start()

    @property
    def closed(self):
        """True once the connection is gone for good."""
        return self._closed

    def _attach(self, sock):
        if self._keepalive:
            _keepalive(sock)
        with self._lock:
            self._sock = sock
            self._last_rx = time.monotonic()
        threading.Thread(target=self._read, args=(sock,), daemon=True, name="ssa-bridge-reader").start()

    # ── the handler thread ───────────────────────────────────────────────────────────────────

    def _pump(self):
        """Calls the handlers, one at a time, off the reader thread."""
        while True:
            item = self._queue.get()
            if item is None:
                return
            name, args = item
            fn = getattr(self, name, None)
            if fn is None:
                continue
            try:
                fn(*args)
            except Exception:
                log.exception("ssa_bridge_client: the %s handler raised", name)

    def _emit(self, name, *args):
        self._queue.put((name, args))

    # ── reading ──────────────────────────────────────────────────────────────────────────────

    def _read(self, sock):
        buf = bytearray()
        start = 0
        why = None
        try:
            while True:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                self._last_rx = time.monotonic()
                buf += chunk
                # Scan only what arrived: a large reply comes in many chunks, and searching the whole
                # buffer for its newline again on every one of them is quadratic.
                pos = 0
                while True:
                    nl = buf.find(b"\n", start)
                    if nl < 0:
                        break
                    line = bytes(buf[pos:nl]).rstrip(b"\r")
                    pos = start = nl + 1
                    if line.strip():
                        self._dispatch(line)
                if pos:
                    del buf[:pos]
                start = len(buf)
                if len(buf) > MAX_LINE_BYTES:
                    # A line this long is not a reply the bridge sends, and nothing after it on this
                    # stream can be trusted.
                    why = "bad_response"
                    break
        except OSError:
            pass
        except Exception:
            log.exception("ssa_bridge_client: the reader stopped")
        finally:
            self._drop(sock, why)

    def _dispatch(self, line):
        try:
            msg = json.loads(line.decode("utf-8"))
        except ValueError:
            self._emit("on_stray", line)
            return
        if isinstance(msg, dict) and "event" in msg and "id" not in msg:
            self._emit("on_event", msg)
            return
        with self._lock:
            slot = self._pending.pop(str(msg.get("id")) if isinstance(msg, dict) else None, None)
            release = slot.pop("release", None) if slot else None
        if slot is None:
            self._emit("on_stray", msg)
            return
        slot["msg"] = msg
        slot["done"].set()
        if release:
            release()

    def _fail_all(self, waiting, code, reason):
        for slot in waiting.values():
            slot["msg"] = _local(code, reason)
            slot["done"].set()
            release = slot.pop("release", None)
            if release:
                release()

    def _drop(self, sock, why=None):
        with self._lock:
            current = sock is self._sock
            if current:
                self._sock = None
                waiting, self._pending = self._pending, {}
        try:
            sock.close()
        except OSError:
            pass
        if not current:
            return
        if why == "bad_response":
            self._fail_all(waiting, "bad_response", "a reply was larger than 8 MB")
        else:
            self._fail_all(waiting, "closed", "the connection closed before the reply arrived")
        if self._reconnecting and not self._closed:
            return                       # a socket opened by the reconnect loop: the loop goes on
        if self._user_closed or not self._reconnect or self._closed:
            self._finish("closed", "the connection closed")
            return
        self._reconnecting = True
        self._emit("on_disconnect", {"code": why or "closed", "reason": "the connection dropped; reconnecting"})
        threading.Thread(target=self._reconnect_loop, daemon=True, name="ssa-bridge-reconnect").start()

    def _finish(self, code, reason):
        """Closed for good: `on_close` is called once."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            self._reconnecting = False
            self.close_reason = {"code": code, "reason": reason}
            waiting, self._pending = self._pending, {}
        self._stop.set()
        self._fail_all(waiting, "closed", reason)
        self._emit("on_close")
        self._queue.put(None)

    # ── heartbeat ────────────────────────────────────────────────────────────────────────────

    def _beat(self):
        """After `heartbeat` seconds of silence, one `status`; no answer to it closes the link."""
        hb = self._heartbeat
        step = min(hb / 4.0, 1.0)
        while not self._stop.wait(step):
            sock = self._sock
            if sock is None or self._reconnecting or time.monotonic() - self._last_rx < hb:
                continue
            msg = self._send("status", None, min(self._timeout, hb), False)[0]
            if msg.get("_client") and msg.get("error") == "timeout" and sock is self._sock:
                # Nothing came back from a link that was silent already: it is dead, not slow.
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                self._drop(sock)

    # ── sending ──────────────────────────────────────────────────────────────────────────────

    def _send(self, action, fields, timeout, hold):
        """One line out, and its reply or the client's own refusal. Returns (msg, rid, slot)."""
        with self._lock:
            sock = self._sock
            if sock is None or self._closed:
                why = "the connection dropped and is reconnecting" if self._reconnecting else "the connection is closed"
                return _local("closed", why, "not_sent"), None, None
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
        try:
            data = (json.dumps(req) + "\n").encode("utf-8")
            with self._wlock:
                sock.sendall(data)
        except (OSError, ValueError) as e:
            # The line never left: the request did not run, and the stream is no longer usable.
            with self._lock:
                self._pending.pop(rid, None)
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            return _local("closed", "the line could not be written: %s" % e, "not_sent"), None, None
        except Exception:
            with self._lock:
                self._pending.pop(rid, None)
            raise
        if not slot["done"].wait(timeout):
            if not hold:
                with self._lock:
                    self._pending.pop(rid, None)
            if slot["msg"] is not None:
                return slot["msg"], rid, slot
            # A request over the bridge's rate budget is queued, not refused: silence is not "no".
            return _local("timeout", "no reply in time; the request may still run"), rid, slot
        return slot["msg"], rid, slot

    def _retry_wait(self, msg, attempt, timeout):
        """Seconds to wait before attempt `attempt + 1`, or None when the refusal is handed back."""
        if msg.get("ok") is not False or msg.get("_client") or msg.get("error") not in RETRYABLE:
            return None
        if is_lockout(msg) or attempt >= self._retries:
            return None
        after = msg.get("retryAfterMs")
        if _number(after) and after >= 0:
            # The bridge said how long. A wait longer than the caller's timeout is the caller's to decide.
            return after / 1000.0 if after / 1000.0 <= timeout else None
        return self._backoff * (attempt + 1)

    def _attempts(self, action, fields, timeout, hold):
        attempt = 0
        while True:
            msg, rid, slot = self._send(action, fields, timeout, hold)
            wait = self._retry_wait(msg, attempt, timeout)
            if wait is None:
                return msg, rid, slot
            time.sleep(wait)
            attempt += 1

    def request(self, action, fields=None, timeout=None):
        """Any action. Waits and sends again on `rate_limited` and `busy`. Never raises for a refusal."""
        if self._reconnecting:
            return _out(_local("closed", "the connection dropped and is reconnecting", "not_sent"))
        return self._request(action, fields, timeout)

    def _request(self, action, fields=None, timeout=None):
        t = timeout if _number(timeout) and timeout > 0 else self._timeout
        if action not in ADMIN_ACTIONS:
            return _out(self._attempts(action, fields, t, False)[0])
        # One admin command on the wire at a time. The slot is held until the bridge has ANSWERED, not
        # until the caller stopped waiting: a timed-out command may still be running.
        if not self._admin.acquire(timeout=t):
            return _out(_local("timeout", "an earlier admin command had not been answered in time, so this one was never sent", "not_sent"))
        held = False
        try:
            msg, rid, slot = self._attempts(action, fields, t, True)
            if rid is not None:
                with self._lock:
                    if rid in self._pending:
                        slot["release"] = self._admin.release
                        held = True
        finally:
            if not held:
                self._admin.release()
        return _out(msg)

    def query(self, module, what, timeout=None):
        return self.request("module_data", {"module": module, "what": what}, timeout)

    def command(self, module, what, timeout=None):
        return self.request("module_command", {"module": module, "what": what}, timeout)

    def configure(self, module, config, timeout=None):
        return self.request("module_config", {"module": module, "config": config}, timeout)

    def modules(self, timeout=None):
        return self.request("modules", None, timeout)

    def players(self, timeout=None):
        return self.request("players", None, timeout)

    def cmd(self, command, executor=None, hide=None, timeout=None):
        fields = {"command": bare_command(command)}
        if executor is not None:
            fields["executor"] = executor
        if hide is not None:
            fields["hide"] = hide
        return self.request("cmd", fields, timeout)

    def chat(self, text, channel=None, targets=None, exclude=None, timeout=None):
        fields = {"text": str(text)}
        for k, v in (("channel", channel), ("targets", targets), ("exclude", exclude)):
            if v is not None:
                fields[k] = v
        return self.request("chat", fields, timeout)

    def subscribe(self, events, timeout=None):
        events = list(events)
        r = self.request("subscribe", {"events": events}, timeout)
        if r["ok"]:
            got = (r.get("result") or {}).get("subscribed") if isinstance(r.get("result"), dict) else None
            self._subs.update(str(e) for e in (got if isinstance(got, list) else events))
        return r

    def close(self):
        self._user_closed = True
        sock = self._sock
        self._finish("closed", "closed by the client")
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass

    # ── reconnecting ─────────────────────────────────────────────────────────────────────────

    def _reconnect_loop(self):
        lo, hi = (float(self._reconnect[0]), float(self._reconnect[1])) if len(self._reconnect) > 1 else (float(self._reconnect[0]), 30.0)
        hi = max(hi, lo)
        attempt = 0
        while not self._closed:
            attempt += 1
            if self._stop.wait(min(hi, lo * 2 ** min(attempt - 1, 20))):
                return
            if self._rediscover is not None:
                try:
                    w = self._rediscover()
                except Exception:
                    w = None
                if not isinstance(w, dict) or not isinstance(w.get("port"), int) or w["port"] <= 0:
                    continue
                self._port = w["port"]
                self._host = w.get("host") or self._host
                self._instance = w.get("instance") or None
            try:
                sock = socket.create_connection((self._host, self._port), timeout=self._timeout)
                sock.settimeout(None)
            except OSError:
                continue
            if self._closed:
                sock.close()
                return
            self._attach(sock)
            h = _handshake(self, self._token, self._instance, self._min_protocol)
            if self._closed:
                return
            if h["ok"]:
                if self._subs:
                    s = self._request("subscribe", {"events": sorted(self._subs)})
                    if not s["ok"] and self._sock is sock:
                        self._drop(sock)
                        continue
                if self._sock is not sock:
                    continue
                self._reconnecting = False
                self._emit("on_reconnect", {"attempt": attempt, "status": self.status})
                return
            fatal = h["code"] in FATAL_ON_RECONNECT and not (h["code"] == "wrong_instance" and self._rediscover is not None)
            if fatal or is_lockout(h):
                self._finish(h["code"], "reconnecting stopped: %s" % h["reason"])
                try:
                    sock.close()
                except OSError:
                    pass
                return
            self._drop(sock)


def _log_in(c, token, instance):
    """`auth` without putting the token on the wire, when the bridge offers it: `status` lists `hmac`
    in `authModes`, `auth_nonce` hands out a nonce for this connection, and the login carries
    `proof` = hex(HMAC-SHA256(token, nonce + "\\n" + instance)). A bridge that does not list `hmac`
    predates it and gets the token itself. A bridge that lists it never does, even if the nonce fails."""
    pre = c._request("status")
    if not pre["ok"]:
        return pre
    modes = (pre.get("result") or {}).get("authModes")
    if isinstance(modes, list) and "hmac" in modes:
        n = c._request("auth_nonce")
        if not n["ok"]:
            return n
        res = n.get("result") or {}
        nonce = str(res.get("nonce") or "")
        inst = instance or str(res.get("instance") or "")
        proof = hmac.new(str(token).encode("utf-8"), (nonce + "\n" + inst).encode("utf-8"), hashlib.sha256).hexdigest()
        return c._request("auth", {"proof": proof})
    return c._request("auth", {"token": token})


def _handshake(c, token, instance, min_protocol):
    """Log in when there is a token, then `status`. Returns {"ok": True} or the refusal."""
    if token:
        a = _log_in(c, token, instance)
        if not a["ok"] and a.get("reasonCode") == "locked_out":
            wait = a.get("retryAfterMs")
            a = dict(a, reason="too many wrong tokens from this address; the bridge closed the connection"
                     + ("" if wait is None else " and accepts auth again in %d ms (retryAfterMs)" % wait))
        if not a["ok"]:
            return a
    st = c._request("status")
    if not st["ok"]:
        return st
    status = st["result"] or {}
    p = status.get("protocol")
    protocol = p if isinstance(p, int) else 1
    if protocol < min_protocol:
        return {"ok": False, "code": "protocol", "reason": "this bridge speaks protocol %d; %d or newer is needed" % (protocol, min_protocol)}
    c.status = status
    c.protocol = protocol
    return {"ok": True}


def connect(port, host="127.0.0.1", token=None, instance=None, caller=None,
            timeout=20.0, backoff=1.0, retries=3, min_protocol=1,
            heartbeat=30.0, keepalive=True, reconnect=None, rediscover=None, **_ignored):
    """One connection: when a token is given, log in first, then `status`. Raises BridgeError only
    when there is no usable connection; the first connection is never retried.

    heartbeat   seconds of silence before the client sends `status` to see whether the link is alive
                (None or 0: never); no answer closes the connection
    keepalive   TCP keepalive on the socket
    reconnect   None (default): a dropped connection stays closed. True, or (min_s, max_s): reconnect
                with a backoff doubling from min_s to max_s, log in again and subscribe again.
                Requests open when it dropped end `closed` and are never resent.
    rediscover  callable returning discover()'s dict, read before every reconnect attempt, for a
                bridge whose port or instance changes when the game restarts
    """
    if not isinstance(port, int) or port <= 0:
        raise BridgeError("no_port", "no port: read it from SSABridge.status.json or ask the owner")
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except OSError as e:
        raise BridgeError("closed", str(e))
    sock.settimeout(None)
    c = BridgeClient(sock, instance=instance, caller=caller, timeout=timeout, backoff=backoff, retries=retries,
                     heartbeat=heartbeat, keepalive=keepalive, reconnect=reconnect, rediscover=rediscover,
                     host=host, port=port, token=token, min_protocol=min_protocol)
    r = _handshake(c, token, instance, min_protocol)
    if not r["ok"]:
        c.close()
        raise BridgeError(r["code"], r["reason"], r.get("reasonCode"), r.get("retryAfterMs"))
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
