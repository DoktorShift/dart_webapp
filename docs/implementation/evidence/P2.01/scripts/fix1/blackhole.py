# Accepts TCP connections on relay B's port (the second of RELAY_PORTS, as lib.mjs reads it) and
# never answers: a relay that hangs (for v4-offline.mjs).
import os, socket
port = int((os.environ.get("RELAY_PORTS") or "18971,18972,18973").split(",")[1])
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", port)); s.listen(50)
conns = []
while True:
    c, _ = s.accept(); conns.append(c)
