(function (root, factory) {
  "use strict";

  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }
  root.TPAuthConfig = exported.resolve(root.location);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const HOSTED = Object.freeze({
    url: "https://oaogomaucuzaelxhogce.supabase.co",
    publishableKey: "sb_publishable_bmQuu7TkYRQEkisolej0Bg_n3MTdibJ"
  });
  const LOCAL = Object.freeze({
    url: "http://127.0.0.1:54321",
    publishableKey: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH"
  });
  const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

  function redirectUrl(locationLike) {
    const href = String(locationLike && locationLike.href || "");
    try {
      return new URL("./", href).href;
    } catch (_) {
      return "";
    }
  }

  function resolve(locationLike) {
    const host = String(locationLike && locationLike.hostname || "").toLowerCase();
    const endpoint = LOCAL_HOSTS.has(host) ? LOCAL : HOSTED;
    return Object.freeze({
      ...endpoint,
      storageKey: "tp_supabase_auth_v1",
      ownerKey: "tp_auth_owner_v1",
      redirectUrl: redirectUrl(locationLike)
    });
  }

  return { HOSTED, LOCAL, resolve, redirectUrl };
});
