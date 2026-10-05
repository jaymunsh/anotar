import { request as httpRequest } from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture(t) {
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const dir = await mkdtemp(join(tmpdir(), "leneu-memo-api-"));
  const child = spawn(process.execPath, ["server/index.mjs"], {
    env: {
      ...process.env,
      AI_RUNNER_KIND: "disabled",
      AI_RUNNER_URL: "",
      DATA_DIR: dir,
      PORT: String(port),
      HOST: "127.0.0.1",
      PRIVATE_ALLOWED_ORIGINS: "https://leneu.private.example",
    },
    stdio: "ignore",
  });
  t.after(async () => {
    child.kill();
    await once(child, "exit");
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(base + "/api/health")).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { base, dir };
}

test("private request boundary rejects foreign mutations and untrusted hosts before changing data", async (t) => {
  const { base, dir } = await fixture(t);
  async function raw(method, path, headers = {}, body = "") {
    return new Promise((resolve, reject) => {
      const req = httpRequest(base + path, { method, headers }, (res) => {
        res.resume();
        res.on("end", () => resolve({ status: res.statusCode }));
      });
      req.on("error", reject);
      req.end(body);
    });
  }
  async function save(headers = {}) {
    const boundary = "leneu-regression-boundary";
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\nnote\r\n--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\n출처 보호 회귀 메모\r\n--${boundary}--\r\n`;
    return raw(
      "POST",
      "/api/captures",
      {
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        ...headers,
      },
      body,
    );
  }
  for (const headers of [
    { Origin: "https://external.invalid", "Sec-Fetch-Site": "cross-site" },
    { Origin: "https://external.invalid" },
    { Origin: "null" },
    { Origin: base, "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" },
    { Origin: "http://localhost:5173" },
    { Host: "rebinding.invalid", Origin: "http://rebinding.invalid" },
    {
      Host: "rebinding.invalid",
      "X-Forwarded-Host": new URL(base).host,
      "X-Forwarded-Proto": "http",
    },
  ])
    assert.equal((await save(headers)).status, 403, JSON.stringify(headers));
  for (const method of ["PUT", "PATCH", "DELETE"])
    assert.equal(
      (
        await fetch(base + "/api/tasks/missing", {
          method,
          headers: {
            Origin: "https://external.invalid",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      403,
    );
  assert.equal(
    (await raw("GET", "/api/health", { Host: "rebinding.invalid" })).status,
    403,
  );
  assert.equal(
    (await (await fetch(base + "/api/captures")).json()).items.length,
    0,
  );
  assert.deepEqual(await readdir(join(dir, "blobs")), []);
  assert.equal(
    (await save({ Origin: base, "Sec-Fetch-Site": "same-origin" })).status,
    201,
  );
  assert.equal((await save()).status, 201); // Existing non-browser CLI/API clients remain usable.
  assert.equal(
    (
      await save({
        Host: "127.0.0.1:5173",
        Origin: "http://127.0.0.1:5173",
        "Sec-Fetch-Site": "same-origin",
      })
    ).status,
    201,
  ); // Vite retains the browser Host through its API proxy.
  assert.equal(
    (
      await save({
        Host: "leneu.private.example",
        Origin: "https://leneu.private.example",
        "Sec-Fetch-Site": "same-origin",
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await save({
        Origin: "https://leneu.private.example",
        "Sec-Fetch-Site": "same-origin",
      })
    ).status,
    201,
  ); // Explicit trusted HTTPS reverse proxy may retain backend Host.
});
