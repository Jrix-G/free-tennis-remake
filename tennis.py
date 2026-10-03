#!/usr/bin/env python3
"""Free Tennis remake launcher: serves the game and relays the 2-player WebSocket link.

Standard library only. Usage: python3 tennis.py [--port 8000] [--no-browser]
"""
import argparse
import base64
import hashlib
import http.server
import json
import os
import socket
import struct
import sys
import threading
import webbrowser
from urllib.parse import urlparse, parse_qs

WEB_DIR = os.path.join(getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__))), 'web')
WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

peers = {}            # role ('host' | 'client') -> WSConn
peers_lock = threading.Lock()


def lan_ips():
    ips = set()
    try:  # route trick: no packet is sent
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    ips.discard('127.0.0.1')
    return sorted(ips) or ['127.0.0.1']


class WSConn:
    def __init__(self, sock):
        self.sock = sock
        self.lock = threading.Lock()
        self.open = True

    def send(self, text):
        data = text.encode('utf-8')
        n = len(data)
        if n < 126:
            head = struct.pack('!BB', 0x81, n)
        elif n < 65536:
            head = struct.pack('!BBH', 0x81, 126, n)
        else:
            head = struct.pack('!BBQ', 0x81, 127, n)
        self._raw(head + data)

    def _raw(self, b):
        with self.lock:
            try:
                self.sock.sendall(b)
            except OSError:
                self.open = False

    def _read(self, n):
        buf = b''
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise ConnectionError
            buf += chunk
        return buf

    def recv(self):
        """Return the next text message, or None when the connection closes."""
        msg = b''
        while True:
            b1, b2 = self._read(2)
            op, n = b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack('!H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('!Q', self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = bytes(c ^ mask[i % 4] for i, c in enumerate(payload))
            if op == 0x8:
                return None
            if op == 0x9:  # ping -> pong
                self._raw(struct.pack('!BB', 0x8A, len(payload)) + payload)
                continue
            if op in (0x0, 0x1, 0x2):
                msg += payload
                if b1 & 0x80:
                    return msg.decode('utf-8', 'replace')


def other(role):
    return 'client' if role == 'host' else 'host'


def notify_peers():
    with peers_lock:
        h, c = peers.get('host'), peers.get('client')
    if h:
        h.send(json.dumps({'t': 'peer', 'on': c is not None}))
    if c:
        c.send(json.dumps({'t': 'peer', 'on': h is not None}))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_DIR, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/info':
            body = json.dumps({'ips': lan_ips(), 'port': self.server.server_address[1]}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif url.path == '/ws' and self.headers.get('Upgrade', '').lower() == 'websocket':
            role = parse_qs(url.query).get('role', ['client'])[0]
            self.websocket(role if role in ('host', 'client') else 'client')
        else:
            super().do_GET()

    def websocket(self, role):
        key = self.headers['Sec-WebSocket-Key']
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode()).digest()).decode()
        self.send_response(101)
        self.send_header('Upgrade', 'websocket')
        self.send_header('Connection', 'Upgrade')
        self.send_header('Sec-WebSocket-Accept', accept)
        self.end_headers()
        self.wfile.flush()
        self.connection.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        conn = WSConn(self.connection)
        with peers_lock:
            old = peers.get(role)
            peers[role] = conn
        if old:  # a newer tab takes the slot
            old.open = False
            try:
                old.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        notify_peers()
        try:
            while conn.open:
                msg = conn.recv()
                if msg is None:
                    break
                with peers_lock:
                    dst = peers.get(other(role))
                if dst:  # dumb relay: the host browser runs the authoritative simulation
                    dst.send(msg)
        except (ConnectionError, OSError):
            pass
        finally:
            with peers_lock:
                if peers.get(role) is conn:
                    del peers[role]
            notify_peers()
        self.close_connection = True


def main():
    ap = argparse.ArgumentParser(description='Free Tennis remake')
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--no-browser', action='store_true')
    args = ap.parse_args()
    http.server.ThreadingHTTPServer.daemon_threads = True
    try:
        srv = http.server.ThreadingHTTPServer(('0.0.0.0', args.port), Handler)
    except OSError as e:
        sys.exit('Port %d indisponible (%s). Essayez --port 8001' % (args.port, e))
    url = 'http://localhost:%d/' % args.port
    print('Free Tennis : %s' % url)
    print('Multijoueur : l\'autre machine rejoint avec %s' %
          ', '.join('%s:%d' % (ip, args.port) for ip in lan_ips()))
    print('Ctrl+C pour quitter.', flush=True)
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, (url,)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
