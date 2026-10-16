"""server.py 확인: python3 test_server.py"""
import http.client
import pathlib
import tempfile
import threading
import http.server

import server

site = pathlib.Path(tempfile.mkdtemp())
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), server.make_handler(site))
threading.Thread(target=srv.serve_forever, daemon=True).start()
port = srv.server_address[1]


def get(path, method="GET"):
    c = http.client.HTTPConnection("127.0.0.1", port)
    c.request(method, path)
    r = c.getresponse()
    return r.status, dict(r.getheaders()), r.read()


assert get("/memory/health")[0] == 200
assert get("/memory/")[0] == 503  # 아직 빌드 전
(site / "index.html").write_text("<p>hi</p>", encoding="utf-8")
status, headers, body = get("/memory/")
assert status == 200 and body == b"<p>hi</p>", (status, body)
assert "frame-ancestors 'none'" in headers["Content-Security-Policy"]
assert headers["Cache-Control"] == "no-store"
status, headers, _ = get("/memory")
assert status == 308 and headers["Location"] == "/memory/"
for bad in ("/", "/memory/../server.py", "/memory/%2e%2e/x", "/memory/index.html/x", "/other"):
    assert get(bad)[0] == 404, bad
status, _, body = get("/memory/", "HEAD")
assert status == 200 and body == b""
srv.shutdown()
print("ok")
