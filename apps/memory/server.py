"""memory 화면 서버 (표준 라이브러리만).

  /memory/          site/index.html (build.py 결과)
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
# viewer.html은 인라인 스크립트와 jsDelivr(marked, DOMPurify, Pretendard)·Google Fonts를 쓴다.
CSP = (
    "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; "
    "style-src 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
    "font-src https://cdn.jsdelivr.net https://fonts.gstatic.com; img-src 'self' data: https:; "
    "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)


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
            if path == PREFIX:
                return self._send(308, extra={"Location": PREFIX + "/"})
            if path == PREFIX + "/health":
                return self._send(200, b"ok")
            if path in (PREFIX + "/", PREFIX + "/index.html"):
                index = site / "index.html"
                if not index.is_file():
                    return self._send(503, "아직 빌드된 화면이 없어요 (build.py).".encode())
                return self._send(200, index.read_bytes(), "text/html; charset=utf-8",
                                  {"Content-Security-Policy": CSP})
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
    print(f"memory: http://{host}:{port}{PREFIX}/ (data {data})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
