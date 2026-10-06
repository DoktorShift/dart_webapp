# Accepts TCP connections on 18972 and never answers: a relay that hangs (for v4-offline.mjs).
import socket, time
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", 18962)); s.listen(50)
conns = []
while True:
    c, _ = s.accept(); conns.append(c)
