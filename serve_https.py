#!/usr/bin/env python3
from http.server import HTTPServer, SimpleHTTPRequestHandler
import ssl

PORT = 8443

httpd = HTTPServer(("0.0.0.0", PORT), SimpleHTTPRequestHandler)
httpd.socket = ssl.wrap_socket(
    httpd.socket,
    certfile="certs/dev.crt",
    keyfile="certs/dev.key",
    server_side=True,
)
print(f"Serving https://localhost:{PORT}")
httpd.serve_forever()
