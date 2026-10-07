import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
const source = (await readFile("public/capture-worker.js", "utf8")).replace(
  /^import .*\n/,
  "",
);
const hash = (value) => createHash("sha256").update(value).digest("hex");
function worker(version, storage, missing = false, fonts = false) {
  const listeners = new Map();
  let takeover = 0;
  const cache = (key) => ({
    match: async (url) =>
      storage
        .get(key)
        ?.get(
          new URL(typeof url === "string" ? url : url.url, "http://localhost")
            .href,
        )
        ?.clone(),
    put: async (url, response) => {
      if (!storage.has(key)) storage.set(key, new Map());
      storage
        .get(key)
        .set(
          new URL(typeof url === "string" ? url : url.url, "http://localhost")
            .href,
          response,
        );
    },
  });
  runInNewContext(source.replace("__LENEU_OFFLINE_VERSION__", version), {
    self: {
      location: { origin: "http://localhost" },
      skipWaiting: async () => {
        takeover++;
      },
      clients: {
        claim: () => {
          takeover++;
        },
      },
      addEventListener: (name, fn) => listeners.set(name, fn),
    },
    caches: {
      open: async (key) => cache(key),
      delete: async (key) => storage.delete(key),
    },
    fetch: async (path) => {
      if (typeof path !== "string") throw new Error("offline");
      return path === "/offline-manifest.json"
        ? Response.json({
            appVersion: version,
            assets: [
              { url: "/index.html", hash: hash("index") },
              { url: "/assets/app.js", hash: hash("script") },
              { url: "/architecture.html", hash: hash("architecture") },
              ...(fonts ? ["/document-fonts.css","/fonts/pretendard.woff2","/fonts/ridibatang.woff2","/fonts/pretendard-OFL.txt"].map(url=>({url,hash:hash("script")})) : []),
            ],
          })
        : new Response(path === "/index.html" ? "index" : path === "/architecture.html" ? "architecture" : "script", {
            status: missing && path === "/assets/app.js" ? 404 : 200,
          });
    },
    Response,
    URL,
    crypto: webcrypto,
    Uint8Array,
    Blob,
  });
  return {
    install: () =>
      new Promise((resolve, reject) =>
        listeners.get("install")({
          waitUntil: (promise) => promise.then(resolve, reject),
        }),
      ),
    takeover: () => takeover,
    navigate: (path, method = "GET", origin = "http://localhost") => {
      let response;
      listeners.get("fetch")({
        request: { url: new URL(path, origin).href, method, mode: "navigate" },
        respondWith: (value) => {
          response = value;
        },
      });
      return response;
    },
  };
}
test("incomplete new shell installation leaves previous ready cache and never automatically takes over tabs", async () => {
  const storage = new Map(),
    old = worker("v1", storage);
  await old.install();
  assert.equal(old.takeover(), 0);
  const next = worker("v2", storage, true);
  await assert.rejects(next.install(), /missing/);
  assert.ok(
    storage
      .get("leneu-shell-v1-v1")
      .has("http://localhost/__leneu_shell_ready__"),
  );
  assert.equal(storage.has("leneu-shell-v1-v2"), false);
  assert.equal(next.takeover(), 0);
});

test("prepared shell serves capture deep links and query links offline while excluding API, shares and external origins", async () => {
  const shell = worker("routes", new Map());
  await shell.install();
  for (const path of [
    "/captures/example",
    "/captures/example?aiJob=historical",
    "/captures/example?ocrJob=historical",
    "/memo",
    "/pages/example",
  ]) {
    const response = await shell.navigate(path);
    assert.ok(response, `Missing offline navigation handler: ${path}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "index");
  }
  for (const path of ["/api/captures/example", "/s/fake", "/not-an-app-route"])
    assert.equal(shell.navigate(path), undefined);
  assert.equal(await (await shell.navigate("/architecture.html")).text(), "architecture");
  assert.equal(shell.navigate("/captures/example", "POST"), undefined);
  assert.equal(
    shell.navigate("/captures/example", "GET", "https://external.invalid"),
    undefined,
  );
});

test('font assets in the build manifest install successfully and remain available offline',async()=>{
  const shell=worker('fonts',new Map(),false,true);
  await shell.install();
  for(const path of ['/document-fonts.css','/fonts/pretendard.woff2','/fonts/ridibatang.woff2','/fonts/pretendard-OFL.txt']){
    assert.equal(await(await shell.navigate(path)).text(),'script');
  }
  assert.equal(shell.navigate('/fonts/../../api/pages'),undefined);
});
