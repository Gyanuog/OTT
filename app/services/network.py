import http.client
import socket
import threading
from urllib.parse import parse_qs, urlsplit
from app.config import YT_PROXY_URL

_upstream = threading.local()


def _recvn(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise OSError("socks proxy closed the connection")
        buf += chunk
    return buf


def _socks5_connect(host, port, timeout):
    """Minimal SOCKS5 CONNECT (no auth, remote DNS) to YT_PROXY_URL."""
    p = urlsplit(YT_PROXY_URL)
    sock = socket.create_connection((p.hostname, p.port or 1080), timeout)
    try:
        sock.sendall(b"\x05\x01\x00")
        if _recvn(sock, 2) != b"\x05\x00":
            raise OSError("socks proxy refused no-auth")
        name = host.encode()
        sock.sendall(b"\x05\x01\x00\x03" + bytes([len(name)]) + name + port.to_bytes(2, "big"))
        head = _recvn(sock, 4)
        if head[1] != 0:
            raise OSError(f"socks connect failed (code {head[1]})")
        addr_len = {1: 4, 4: 16}.get(head[3]) or _recvn(sock, 1)[0]
        _recvn(sock, addr_len + 2)
        return sock
    except BaseException:
        sock.close()
        raise


class _SocksHTTPSConnection(http.client.HTTPSConnection):
    def connect(self):
        sock = _socks5_connect(self.host, self.port, self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def upstream_get(url, headers):
    """GET via a per-thread keep-alive connection to the googlevideo host, so
    consecutive chunk requests skip the TCP+TLS handshake. Retries once on a
    stale pooled connection."""
    u = urlsplit(url)
    path = u.path + ("?" + u.query if u.query else "")
    # googlevideo URLs are bound to the client IP (ip=...); connect over the same family.
    ip = (parse_qs(u.query).get("ip") or [""])[0]
    src = ("::", 0) if ":" in ip else ("0.0.0.0", 0)
    pool = getattr(_upstream, "conns", None)
    if pool is None:
        pool = _upstream.conns = {}
    for attempt in (0, 1):
        conn = pool.get(u.netloc)
        if conn is None:
            conn = pool[u.netloc] = (_SocksHTTPSConnection(u.netloc, timeout=20) if YT_PROXY_URL
                                     else http.client.HTTPSConnection(u.netloc, timeout=20, source_address=src))
        try:
            conn.request("GET", path, headers=headers)
            return conn, conn.getresponse()
        except (http.client.HTTPException, OSError):
            conn.close()
            pool.pop(u.netloc, None)
            if attempt:
                raise


def drop_upstream(conn):
    conn.close()
    for k, c in list(getattr(_upstream, "conns", {}).items()):
        if c is conn:
            del _upstream.conns[k]
