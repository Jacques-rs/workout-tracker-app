#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const handlers = {};

const context = {
  URL,
  Promise,
  self: {
    location: { origin: "http://localhost:8000" },
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
    skipWaiting() {},
    clients: { claim() {} }
  },
  caches: {
    open: async () => ({ addAll: async () => {}, put: async () => {} }),
    keys: async () => [],
    delete: async () => true,
    match: async () => undefined
  },
  fetch: async () => ({ ok: true, clone() { return this; } })
};

vm.runInNewContext(source, context, { filename: "sw.js" });
assert.equal(typeof handlers.fetch, "function", "service worker registers fetch handling");

function dispatch(url, method = "GET") {
  let response;
  const event = {
    request: { url, method },
    respondWith(value) { response = value; }
  };
  handlers.fetch(event);
  return response;
}

assert.equal(
  dispatch("http://127.0.0.1:54321/auth/v1/token?grant_type=password"),
  undefined,
  "cross-origin Supabase requests bypass the app-shell cache"
);
assert.equal(
  dispatch("https://example.supabase.co/auth/v1/recover"),
  undefined,
  "hosted Supabase requests bypass the app-shell cache"
);
assert.equal(
  dispatch("http://localhost:8000/index.html", "POST"),
  undefined,
  "non-GET requests bypass the app-shell cache"
);
assert.ok(
  dispatch("http://localhost:8000/js/auth-client.js") instanceof Promise,
  "same-origin app assets use the cache"
);
assert.ok(
  dispatch("http://localhost:8000/program.json") instanceof Promise,
  "programme updates retain their network-first strategy"
);

for (const asset of [
  "./vendor/supabase-js-2.111.0.min.js",
  "./js/auth-config.js",
  "./js/auth-client.js",
  "./js/auth-ui.js"
]) {
  assert.ok(source.includes(asset), `${asset} is precached`);
}

console.log("Service-worker authentication boundary tests passed.");
