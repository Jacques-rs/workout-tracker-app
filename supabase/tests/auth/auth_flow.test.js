#!/usr/bin/env node
/*
 * Local-only Supabase Auth integration proof.
 *
 * The script obtains local credentials from `supabase status` in memory and never prints
 * them. Every address is randomized under `.invalid`; Mailpit captures all messages.
 */
"use strict";

const { execFileSync } = require("child_process");
const { randomUUID } = require("crypto");

const REDIRECT_URL = "http://127.0.0.1:8000/";
const PASSWORD_ONE = "localAuth123";
const PASSWORD_TWO = "localAuth456";

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log("  ok   " + message);
}

function localStatus() {
  const output = execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const status = JSON.parse(output);
  for (const key of ["API_URL", "PUBLISHABLE_KEY", "SECRET_KEY", "MAILPIT_URL"])
    if (!status[key]) throw new Error(`local Supabase status is missing ${key}`);
  return status;
}

async function request(url, options = {}) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
}

function jsonHeaders(apiKey, bearer) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${bearer || apiKey}`,
    "Content-Type": "application/json"
  };
}

async function expectStatus(response, status, label) {
  if (response.status !== status) {
    let detail = "";
    try {
      const body = await response.clone().json();
      detail = ` (${body.error_code || body.code || "unknown_error"}: ${body.msg || body.message || "no detail"})`;
    } catch (_) {}
    throw new Error(`${label}: expected HTTP ${status}, received ${response.status}${detail}`);
  }
  return response;
}

async function mailFor(mailpitUrl, email, subjectPattern) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const response = await request(`${mailpitUrl}/api/v1/messages`);
    await expectStatus(response, 200, "Mailpit message list");
    const data = await response.json();
    const message = (data.messages || []).find(item =>
      (item.To || []).some(to => to.Address === email) && subjectPattern.test(item.Subject || ""));
    if (message) return message;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Mailpit did not receive the expected fake auth email");
}

async function emailLink(mailpitUrl, messageId) {
  const response = await request(`${mailpitUrl}/api/v1/message/${encodeURIComponent(messageId)}`);
  await expectStatus(response, 200, "Mailpit message body");
  const message = await response.json();
  const match = String(message.HTML || message.Text || "").match(/href=["']([^"']+)["']/i);
  if (!match) throw new Error("Captured auth email has no action link");
  return match[1].replaceAll("&amp;", "&");
}

async function redeem(link, expectedType) {
  const response = await request(link, { redirect: "manual" });
  check(response.status === 302 || response.status === 303,
    `${expectedType} email action redirects to the app`);
  const location = new URL(response.headers.get("location"));
  check(location.origin + location.pathname === REDIRECT_URL,
    `${expectedType} uses the configured local redirect URL`);
  const params = new URLSearchParams(location.hash.slice(1));
  check(params.get("type") === expectedType, `${expectedType} redirect carries its flow type`);
  check(params.has("access_token") && params.has("refresh_token"),
    `${expectedType} redirect carries a browser session`);
  return { accessToken: params.get("access_token"), refreshToken: params.get("refresh_token") };
}

async function main() {
  const status = localStatus();
  const api = status.API_URL;
  const email = `auth-${randomUUID()}@example.invalid`;
  const uninvited = `signup-${randomUUID()}@example.invalid`;
  let userId = null;

  console.log("\nlocal Supabase invite and recovery flow");
  try {
    const signup = await request(`${api}/auth/v1/signup`, {
      method: "POST", headers: jsonHeaders(status.PUBLISHABLE_KEY),
      body: JSON.stringify({ email: uninvited, password: PASSWORD_ONE })
    });
    check(signup.status === 400 || signup.status === 422, "public email/password signup is disabled");
    const signupError = await signup.json();
    check((signupError.error_code || signupError.code) === "signup_disabled",
      "signup rejection exposes the stable signup_disabled code");

    const inviteUrl = new URL(`${api}/auth/v1/invite`);
    inviteUrl.searchParams.set("redirect_to", REDIRECT_URL);
    const invite = await request(inviteUrl, {
      method: "POST", headers: jsonHeaders(status.SECRET_KEY, status.SECRET_KEY),
      body: JSON.stringify({ email, data: { fixture: "auth-flow" } })
    });
    await expectStatus(invite, 200, "administrator invitation");
    const invitedUser = await invite.json();
    userId = invitedUser.id;
    check(!!userId, "administrator invitation creates a fake local user");

    const inviteMail = await mailFor(status.MAILPIT_URL, email, /invited/i);
    check(!!inviteMail.ID, "Mailpit captures the invitation email");
    const inviteSession = await redeem(await emailLink(status.MAILPIT_URL, inviteMail.ID), "invite");

    const invitedProfile = await request(`${api}/auth/v1/user`, {
      headers: jsonHeaders(status.PUBLISHABLE_KEY, inviteSession.accessToken)
    });
    await expectStatus(invitedProfile, 200, "verified invited user");
    const profile = await invitedProfile.json();
    check(!!profile.email_confirmed_at, "accepting the invitation verifies the email address");

    const setPassword = await request(`${api}/auth/v1/user`, {
      method: "PUT", headers: jsonHeaders(status.PUBLISHABLE_KEY, inviteSession.accessToken),
      body: JSON.stringify({ password: PASSWORD_ONE })
    });
    await expectStatus(setPassword, 200, "invite password setup");
    check(true, "the invited user can set a password");

    const firstLogin = await request(`${api}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: jsonHeaders(status.PUBLISHABLE_KEY),
      body: JSON.stringify({ email, password: PASSWORD_ONE })
    });
    await expectStatus(firstLogin, 200, "password sign-in after invite");
    check(true, "the invited account can sign in with its password");

    const recoveryUrl = new URL(`${api}/auth/v1/recover`);
    recoveryUrl.searchParams.set("redirect_to", REDIRECT_URL);
    const recovery = await request(recoveryUrl, {
      method: "POST", headers: jsonHeaders(status.PUBLISHABLE_KEY),
      body: JSON.stringify({ email })
    });
    await expectStatus(recovery, 200, "password recovery request");
    check(true, "recovery accepts the invited account without returning identity details");

    const recoveryMail = await mailFor(status.MAILPIT_URL, email, /reset/i);
    check(!!recoveryMail.ID, "Mailpit captures the recovery email");
    const recoverySession = await redeem(await emailLink(status.MAILPIT_URL, recoveryMail.ID), "recovery");

    const changePassword = await request(`${api}/auth/v1/user`, {
      method: "PUT", headers: jsonHeaders(status.PUBLISHABLE_KEY, recoverySession.accessToken),
      body: JSON.stringify({ password: PASSWORD_TWO })
    });
    await expectStatus(changePassword, 200, "recovery password update");
    check(true, "the recovery session can choose a new password");

    const newLogin = await request(`${api}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: jsonHeaders(status.PUBLISHABLE_KEY),
      body: JSON.stringify({ email, password: PASSWORD_TWO })
    });
    await expectStatus(newLogin, 200, "new password sign-in");
    check(true, "the new password signs in successfully");

    const oldLogin = await request(`${api}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: jsonHeaders(status.PUBLISHABLE_KEY),
      body: JSON.stringify({ email, password: PASSWORD_ONE })
    });
    check(oldLogin.status === 400, "the superseded password no longer signs in");
  } finally {
    if (userId) {
      await request(`${api}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
        method: "DELETE", headers: jsonHeaders(status.SECRET_KEY, status.SECRET_KEY)
      }).catch(() => {});
    }
  }
}

main().then(() => {
  console.log("\nall local auth integration checks passed\n");
}).catch(error => {
  // Deliberately print only our sanitized assertion text, never response bodies or tokens.
  console.error("\nauth integration FAILED: " + error.message + "\n");
  process.exit(1);
});
