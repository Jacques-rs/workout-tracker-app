/* Dependency-free tests for the browser auth state machine. */
"use strict";

const configModule = require("../js/auth-config.js");
const authModule = require("../js/auth-client.js");
const authUiModule = require("../js/auth-ui.js");

let failures = 0;
function ok(condition, message) {
  if (condition) console.log("  ok   " + message);
  else { console.error("  FAIL " + message); failures++; }
}
function same(actual, expected, message) {
  ok(JSON.stringify(actual) === JSON.stringify(expected),
    `${message}${JSON.stringify(actual) === JSON.stringify(expected) ? "" : `\n       expected ${JSON.stringify(expected)}\n       got      ${JSON.stringify(actual)}`}`);
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: key => map.delete(key),
    snapshot: () => Object.fromEntries(map)
  };
}

function fakeSupabase(initialSession = null) {
  let listener = null;
  let session = initialSession;
  let nextSignIn = initialSession;
  const calls = [];
  const auth = {
    onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe(){} } } }; },
    async initialize() { if (listener) listener(session ? "SIGNED_IN" : "INITIAL_SESSION", session); return { error: null }; },
    async signInWithPassword(credentials) {
      calls.push(["signInWithPassword", credentials]);
      session = nextSignIn;
      return session ? { data: { session }, error: null }
        : { data: null, error: { code: "invalid_credentials" } };
    },
    async resetPasswordForEmail(email, options) {
      calls.push(["resetPasswordForEmail", email, options]); return { data: {}, error: null };
    },
    async updateUser(attributes) { calls.push(["updateUser", attributes]); return { data: { user: session && session.user }, error: null }; },
    async getSession() { return { data: { session }, error: null }; },
    async signOut(options) { calls.push(["signOut", options]); session = null; return { error: null }; },
    async refreshSession() { calls.push(["refreshSession"]); return { data: { session }, error: null }; }
  };
  return {
    createClient(url, key, options) { calls.push(["createClient", url, key, options]); return { auth }; },
    calls,
    emit(event, value) { session = value; if (listener) listener(event, value); },
    setNextSignIn(value) { nextSignIn = value; }
  };
}

function person(id, email = `${id}@example.invalid`) {
  return { user: { id, email, email_confirmed_at: "2026-01-01T00:00:00Z" },
    access_token: "not-logged", refresh_token: "not-logged" };
}

function makeClient({ storage = memoryStorage(), fake = fakeSupabase(), href = "https://example.test/app/",
  search = "", hash = "", online = true } = {}) {
  const historyCalls = [];
  const location = new URL(href);
  if (search) location.search = search;
  if (hash) location.hash = hash;
  const config = { url: "https://project.supabase.co", publishableKey: "sb_publishable_test",
    storageKey: "tp_supabase_auth_v1", ownerKey: "tp_auth_owner_v1",
    redirectUrl: new URL("./", location.href).href };
  const listeners = {};
  const client = authModule.createAuthClient({
    createClient: fake.createClient,
    config, storage, location,
    history: { replaceState(_a, _b, url) { historyCalls.push(url); } },
    navigator: { onLine: online },
    addWindowListener(name, handler) { listeners[name] = handler; }
  });
  return { client, fake, storage, historyCalls, listeners, config };
}

(async () => {
  console.log("\nauth configuration and callback parsing");
  same(configModule.resolve(new URL("http://localhost:8000/")).url, "http://127.0.0.1:54321",
    "localhost uses the local Supabase stack");
  same(configModule.resolve(new URL("https://jacques-rs.github.io/workout-tracker-app/")).url,
    "https://oaogomaucuzaelxhogce.supabase.co", "the deployed origin uses the hosted project");
  same(configModule.redirectUrl(new URL("https://example.test/app/#type=invite&access_token=x")),
    "https://example.test/app/", "the callback URL drops auth fragments and keeps the subpath");
  same(authModule.authReturn({ search: "", hash: "#type=invite&access_token=x" }).flow,
    "invite", "invite is captured before the SDK cleans the URL");
  same(authModule.authReturn({ search: "", hash: "#type=recovery&access_token=x" }).flow,
    "recovery", "recovery is captured too");
  same(authModule.authReturn({ search: "", hash: "#error_code=otp_expired&error_description=Expired" }).errorCode,
    "otp_expired", "redirect errors are retained for useful UI copy");

  console.log("\ninvite acceptance and password setup");
  {
    const fake = fakeSupabase(person("user-one", "one@example.invalid"));
    const ctx = makeClient({ fake, hash: "#type=invite&access_token=secret&refresh_token=secret" });
    await ctx.client.init(); await tick();
    same(ctx.client.getState().status, "setup-required", "an invite session requires password setup");
    same(ctx.client.getState().owner, {
      userId: "user-one", email: "one@example.invalid", signedOut: false, pendingFlow: "invite"
    }, "the first verified account binds the installation without storing tokens");
    same(ctx.historyCalls, ["https://example.test/app/"], "auth credentials are removed from browser history");
    const result = await ctx.client.updatePassword("strong123");
    ok(result.ok, "the invited user can set a password");
    same(ctx.client.getState().status, "authenticated", "password setup completes the account");
    same(JSON.parse(ctx.storage.snapshot().tp_auth_owner_v1).pendingFlow, null,
      "unfinished setup does not survive after success");
  }

  console.log("\nlocal sign-out and remembered offline ownership");
  {
    const storage = memoryStorage({ tp_program_v1: "personal-program", "tp_sess_v1::date::day": "workout" });
    const fake = fakeSupabase(person("user-one", "one@example.invalid"));
    const ctx = makeClient({ fake, storage });
    await ctx.client.init(); await tick();
    const result = await ctx.client.signOutLocal();
    ok(result.ok, "local sign-out succeeds");
    same(fake.calls.find(call => call[0] === "signOut")[1], { scope: "local" },
      "sign-out affects this browser session only");
    same(storage.snapshot().tp_program_v1, "personal-program", "sign-out preserves the cached programme");
    same(storage.snapshot()["tp_sess_v1::date::day"], "workout", "sign-out preserves cached workouts");
    ok(JSON.parse(storage.snapshot().tp_auth_owner_v1).signedOut, "the explicit signed-out state is remembered");
    ok(!ctx.client.canImport(), "an explicitly signed-out owner must sign in before importing");

    const offline = makeClient({ storage, fake: fakeSupabase(null), online: false });
    await offline.client.init(); await tick();
    same(offline.client.getState().status, "guest", "explicit sign-out remains signed out while offline");
  }

  {
    const owner = { userId: "user-one", email: "one@example.invalid", signedOut: false, pendingFlow: null };
    const storage = memoryStorage({ tp_auth_owner_v1: JSON.stringify(owner) });
    const ctx = makeClient({ storage, fake: fakeSupabase(null), online: false });
    await ctx.client.init(); await tick();
    same(ctx.client.getState().status, "offline-owner", "a remembered owner is not locked out without signal");
    ok(ctx.client.canImport(), "that remembered owner may import locally while offline");
  }

  console.log("\ninstallation ownership conflict");
  {
    const owner = { userId: "user-one", email: "one@example.invalid", signedOut: true, pendingFlow: null };
    const storage = memoryStorage({ tp_auth_owner_v1: JSON.stringify(owner), tp_program_v1: "keep-me" });
    const fake = fakeSupabase(null);
    fake.setNextSignIn(person("user-two", "two@example.invalid"));
    const ctx = makeClient({ storage, fake });
    await ctx.client.init(); await tick();
    const result = await ctx.client.signIn("two@example.invalid", "strong123");
    ok(!result.ok && result.error.code === "account_conflict", "a different account is rejected");
    same(JSON.parse(storage.snapshot().tp_auth_owner_v1).userId, "user-one", "the original device owner is unchanged");
    same(storage.snapshot().tp_program_v1, "keep-me", "the conflict deletes no workout data");
    same(ctx.client.getState().status, "conflict", "the UI receives an explicit conflict state");
  }

  console.log("\nrecovery and public surface");
  {
    const ctx = makeClient({ fake: fakeSupabase(null) });
    await ctx.client.init(); await tick();
    const result = await ctx.client.requestRecovery("unknown@example.invalid");
    ok(result.ok, "recovery returns a generic success");
    const call = ctx.fake.calls.find(item => item[0] === "resetPasswordForEmail");
    same(call[2], { redirectTo: "https://example.test/app/" }, "recovery returns to the exact app subpath");
    same(typeof ctx.client.signUp, "undefined", "the browser auth API exposes no public sign-up path");
  }
  ok(authUiModule.validPassword("letters1"), "the configured letters-and-digits password rule passes");
  ok(!authUiModule.validPassword("lettersonly"), "a password without a digit is rejected before the request");
  ok(!authUiModule.validPassword("12345678"), "a password without a letter is rejected before the request");

  console.log(failures ? `\n${failures} FAILED\n` : "\nall passed\n");
  process.exit(failures ? 1 : 0);
})().catch(error => {
  console.error("auth tests failed: " + error.message);
  process.exit(1);
});
