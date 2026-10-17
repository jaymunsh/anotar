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
for old in ("/memory", "/memory/", "/memory/index.html"):
    status, headers, _ = get(old)
    assert status == 302 and headers["Location"] == "/wiki", (old, status)
assert get("/memory/data.json")[0] == 503
(site / "data.json").write_text('{"wiki":[],"sessions":[]}', encoding="utf-8")
status, headers, body = get("/memory/data.json")
assert status == 200 and headers["Content-Type"].startswith("application/json") and b"wiki" in body
for bad in ("/", "/memory/../server.py", "/memory/%2e%2e/x", "/memory/index.html/x", "/other"):
    assert get(bad)[0] == 404, bad
assert headers["Cache-Control"] == "no-store"
status, _, body = get("/memory/data.json", "HEAD")
assert status == 200 and body == b""
srv.shutdown()
print("ok")
