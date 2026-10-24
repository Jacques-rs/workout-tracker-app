(function (root, factory) {
  "use strict";
  const exported = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exported;
    return;
  }
  root.TPAuthUI = exported.createAuthUI(root.document, root.TPAuth);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function node(document, tag, props, children) {
    const element = document.createElement(tag);
    Object.entries(props || {}).forEach(([key, value]) => {
      if (key === "className") element.className = value;
      else if (key === "textContent") element.textContent = value;
      else if (key === "attrs") Object.entries(value).forEach(([name, attr]) => element.setAttribute(name, attr));
      else element[key] = value;
    });
    (Array.isArray(children) ? children : [children]).forEach(child => {
      if (child != null) element.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return element;
  }

  function validPassword(value) {
    const password = String(value || "");
    return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
  }

  function createAuthUI(document, auth) {
    let toast = () => {};
    let returnFocus = null;
    let initialized = false;
    let unsubscribe = null;
    let lastAutoFlow = null;

    const $ = selector => document && document.querySelector(selector);
    const wrap = () => $("#authWrap");
    const openNow = () => !!(wrap() && wrap().classList.contains("in"));

    function setError(host, message) {
      host.textContent = message || "";
      host.hidden = !message;
    }

    function setBusy(button, busy, label) {
      button.disabled = busy;
      button.textContent = busy ? "Working…" : label;
    }

    function modal(title, copy, body, options) {
      const host = wrap();
      if (!host) return;
      returnFocus = document.activeElement;
      $("#authTitle").textContent = title;
      $("#authCopy").textContent = copy || "";
      const content = $("#authBody");
      content.innerHTML = "";
      content.append(body);
      host.dataset.locked = options && options.locked ? "true" : "false";
      host.classList.add("in");
      host.setAttribute("aria-hidden", "false");
      document.body.classList.add("noscroll");
      const first = content.querySelector("input,button");
      if (first) setTimeout(() => first.focus(), 0);
    }

    function close() {
      const host = wrap();
      if (!host || !host.classList.contains("in")) return;
      host.classList.remove("in");
      host.setAttribute("aria-hidden", "true");
      host.dataset.locked = "false";
      const sheet = $("#sheetWrap");
      if (!(sheet && sheet.classList.contains("in")))
        document.body.classList.remove("noscroll");
      if (returnFocus && returnFocus.focus) returnFocus.focus();
      returnFocus = null;
    }

    function messagePanel(message, buttonLabel) {
      const body = node(document, "div");
      body.append(node(document, "p", { className: "auth-message" }, message));
      const done = node(document, "button", { className: "primary", textContent: buttonLabel || "Done" });
      done.onclick = close;
      body.append(done);
      return body;
    }

    function signInForm() {
      const state = auth.getState();
      const form = node(document, "form", { className: "auth-form" });
      const email = node(document, "input", { type: "email", value: state.owner && state.owner.email || "",
        attrs: { required: "", autocomplete: "username", inputmode: "email", "aria-label": "Email address" } });
      const password = node(document, "input", { type: "password",
        attrs: { required: "", autocomplete: "current-password", "aria-label": "Password" } });
      const error = node(document, "div", { className: "auth-error", hidden: true, attrs: { role: "alert" } });
      const submit = node(document, "button", { className: "primary", type: "submit", textContent: "Sign in" });
      const forgot = node(document, "button", { className: "quietaction", type: "button", textContent: "Forgot password?" });
      forgot.onclick = () => open("recovery");
      form.append(node(document, "label", { className: "auth-field" }, [
        node(document, "span", {}, "Email"), email
      ]));
      form.append(node(document, "label", { className: "auth-field" }, [
        node(document, "span", {}, "Password"), password
      ]));
      form.append(error, submit, forgot);
      form.onsubmit = async event => {
        event.preventDefault();
        setError(error, ""); setBusy(submit, true, "Sign in");
        const result = await auth.signIn(email.value, password.value);
        setBusy(submit, false, "Sign in");
        if (!result.ok) { setError(error, result.error.message); return; }
        close(); toast("Signed in");
      };
      return form;
    }

    function recoveryForm() {
      const state = auth.getState();
      const form = node(document, "form", { className: "auth-form" });
      const email = node(document, "input", { type: "email", value: state.owner && state.owner.email || "",
        attrs: { required: "", autocomplete: "email", inputmode: "email", "aria-label": "Email address" } });
      const error = node(document, "div", { className: "auth-error", hidden: true, attrs: { role: "alert" } });
      const submit = node(document, "button", { className: "primary", type: "submit", textContent: "Send reset email" });
      const back = node(document, "button", { className: "quietaction", type: "button", textContent: "Back to sign in" });
      back.onclick = () => open("sign-in");
      form.append(node(document, "label", { className: "auth-field" }, [
        node(document, "span", {}, "Email"), email
      ]), error, submit, back);
      form.onsubmit = async event => {
        event.preventDefault();
        setError(error, ""); setBusy(submit, true, "Send reset email");
        const result = await auth.requestRecovery(email.value);
        setBusy(submit, false, "Send reset email");
        if (!result.ok) { setError(error, result.error.message); return; }
        modal("Check your email",
          "If that address belongs to an invited account, a reset link is on its way.",
          messagePanel("Open the link on this device to choose a new password."));
      };
      return form;
    }

    function passwordForm() {
      const state = auth.getState();
      const invite = state.flow === "invite" || state.owner && state.owner.pendingFlow === "invite";
      const form = node(document, "form", { className: "auth-form" });
      const password = node(document, "input", { type: "password",
        attrs: { required: "", minlength: "8", autocomplete: "new-password", "aria-label": "New password" } });
      const confirm = node(document, "input", { type: "password",
        attrs: { required: "", minlength: "8", autocomplete: "new-password", "aria-label": "Confirm new password" } });
      const error = node(document, "div", { className: "auth-error", hidden: true, attrs: { role: "alert" } });
      const submit = node(document, "button", { className: "primary", type: "submit",
        textContent: invite ? "Accept invitation" : "Update password" });
      form.append(node(document, "p", { className: "auth-rule" },
        "Use at least 8 characters, including a letter and a number."));
      form.append(node(document, "label", { className: "auth-field" }, [
        node(document, "span", {}, "New password"), password
      ]));
      form.append(node(document, "label", { className: "auth-field" }, [
        node(document, "span", {}, "Confirm password"), confirm
      ]));
      form.append(error, submit);
      form.onsubmit = async event => {
        event.preventDefault(); setError(error, "");
        if (!validPassword(password.value)) {
          setError(error, "Use at least 8 characters, including a letter and a number."); return;
        }
        if (password.value !== confirm.value) { setError(error, "Passwords do not match."); return; }
        const label = invite ? "Accept invitation" : "Update password";
        setBusy(submit, true, label);
        const result = await auth.updatePassword(password.value);
        setBusy(submit, false, label);
        if (!result.ok) { setError(error, result.error.message); return; }
        close(); toast(invite ? "Invitation accepted — signed in" : "Password updated");
      };
      return { form, invite };
    }

    function open(mode) {
      if (!document || !auth) return;
      if (mode === "recovery") {
        modal("Reset password", "We will send a secure link to your invited account.", recoveryForm());
        return;
      }
      if (mode === "password") {
        const built = passwordForm();
        modal(built.invite ? "Finish account setup" : "Choose a new password",
          built.invite ? "Your invitation verified this email address." : "This recovery link is ready to use.",
          built.form, { locked: true });
        return;
      }
      if (mode === "error") {
        const state = auth.getState();
        modal("Account link problem", "The invitation or recovery link could not be used.",
          messagePanel(state.error && state.error.message || "Ask for a new link and try again."));
        return;
      }
      modal("Sign in", "Private beta accounts are created by administrator invitation.", signInForm());
    }

    function renderAccount(host) {
      host.innerHTML = "";
      const state = auth.getState();
      const copy = node(document, "p", { className: "dnote auth-status" });
      const actions = node(document, "div", { className: "btnrow" });
      if (state.status === "loading") copy.textContent = "Checking account…";
      else if (state.status === "authenticated") {
        copy.textContent = `${state.user.email} · ${state.user.verified ? "email verified" : "verification pending"}`;
        const signout = node(document, "button", { className: "ghost", textContent: "Sign out on this device" });
        signout.onclick = async () => {
          await auth.signOutLocal();
          toast("Signed out — workout data remains on this device");
        };
        actions.append(signout);
      } else if (state.status === "offline-owner") {
        copy.textContent = `Offline · ${state.owner.email || "known account"}. Cached workouts remain available.`;
      } else if (state.status === "setup-required") {
        copy.textContent = `${state.owner.email || "Invited account"} · password setup required.`;
        const finish = node(document, "button", { className: "primary", textContent: "Finish account setup" });
        finish.onclick = () => open("password"); actions.append(finish);
      } else if (state.status === "conflict") {
        copy.textContent = "This installation belongs to another beta account. Use a separate browser profile or deliberately clear this site's data.";
      } else if (state.status === "unavailable") {
        copy.textContent = "Account services are unavailable. Cached workouts still work.";
      } else {
        copy.textContent = state.owner && state.owner.signedOut
          ? `Signed out · ${state.owner.email}. Workout data remains on this device.`
          : "Sign in to import a personal program and use future cloud backup.";
        const signin = node(document, "button", { className: "primary", textContent: "Sign in" });
        signin.onclick = () => open("sign-in"); actions.append(signin);
      }
      host.append(copy);
      if (actions.children.length) host.append(actions);
    }

    function handleKeydown(event) {
      if (!openNow()) return false;
      if (event.key === "Escape") { event.preventDefault(); close(); return true; }
      if (event.key !== "Tab") return true;
      const nodes = Array.from($("#authDialog").querySelectorAll("button,input"))
        .filter(item => !item.disabled && !item.hidden);
      if (!nodes.length) return true;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      return true;
    }

    function init(options) {
      if (initialized || !document || !auth) return;
      initialized = true;
      toast = options && options.toast || toast;
      const closeButton = $("#authClose");
      const background = $("#authBg");
      if (closeButton) closeButton.onclick = close;
      if (background) background.onclick = close;
      unsubscribe = auth.subscribe(state => {
        if (state.status === "setup-required" && state.flow && lastAutoFlow !== state.flow) {
          lastAutoFlow = state.flow; open("password");
        } else if (state.error && ["otp_expired", "access_denied", "bad_code_verifier"].includes(state.error.code)) {
          open("error");
        }
      });
    }

    return { init, open, close, isOpen: openNow, renderAccount, handleKeydown,
      destroy() { if (unsubscribe) unsubscribe(); unsubscribe = null; initialized = false; },
      validPassword };
  }

  return { createAuthUI, validPassword };
});
