"""memory 화면 서버 (표준 라이브러리만).

  /memory, /memory/ /wiki로 302 (예전 단독 화면 주소)
  /memory/data.json build.py가 만든 데이터 (anotar /wiki 화면이 읽음)
  /memory/health    200 "ok"
  그 외             404

인증은 앞단(Caddy forward_auth → anotar /api/auth/check)이 맡는다. 이 서버는 루프백이나
docker 내부 네트워크에만 연다. 데이터 폴더는 MEMORY_DATA, 없으면 현재 폴더.
"""
import http.server
import os
import pathlib
import sys

PREFIX = "/memory"


def make_handler(site: pathlib.Path):
    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "memory"
        sys_version = ""

        def _send(self, status, body=b"", ctype="text/plain; charset=utf-8", extra=None):
            self.send_response(status)
            headers = {
                "Content-Type": ctype,
                "Content-Length": str(len(body)),
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                **(extra or {}),
            }
            for k, v in headers.items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path in (PREFIX, PREFIX + "/", PREFIX + "/index.html"):
                return self._send(302, extra={"Location": "/wiki"})
            if path == PREFIX + "/health":
                return self._send(200, b"ok")
            if path == PREFIX + "/data.json":
                data = site / "data.json"
                if not data.is_file():
                    return self._send(503, b'{"error":"not_built"}', "application/json; charset=utf-8")
                return self._send(200, data.read_bytes(), "application/json; charset=utf-8")
            self._send(404, b"not found")

        do_HEAD = do_GET

        def log_message(self, fmt, *args):  # 경로만 남기고 쿠키·헤더는 남기지 않는다
            sys.stderr.write("%s %s\n" % (self.command, self.path.split("?", 1)[0]))

    return Handler


def main():
    data = pathlib.Path(os.environ.get("MEMORY_DATA", os.getcwd()))
    host = os.environ.get("MEMORY_HOST", "127.0.0.1")
    port = int(os.environ.get("MEMORY_PORT", "8788"))
    server = http.server.ThreadingHTTPServer((host, port), make_handler(data / "site"))
    print(f"memory: http://{host}:{port}{PREFIX}/data.json (data {data})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
