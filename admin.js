// Op4n Admin sign-in (Feature Inventory: "Require MFA and least privilege for
// Admin access"). Supabase Auth password sign-in, then TOTP: enroll on first
// use, challenge afterwards. Every Admin API call sends the aal2 access token;
// the server enforces issuer, audience, founder allowlist, aal2, and recent
// sign-in for high-risk actions. This page holds no secret: the publishable
// key is public by design and grants nothing without the founder's MFA session.
(function () {
  "use strict";

  const config = window.OP4N_RUNTIME_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const panels = ["unavailablePanel", "signInForm", "enrollForm", "challengeForm", "sessionPanel"];
  const state = { client: null, enrollFactorId: null, busy: false };

  const titles = {
    unavailablePanel: "Admin unavailable",
    signInForm: "Admin sign in",
    enrollForm: "Set up authenticator",
    challengeForm: "Verify it’s you",
    sessionPanel: "Admin",
  };

  function show(panelId) {
    for (const id of panels) $(id).hidden = id !== panelId;
    $("adminTitle").textContent = titles[panelId];
    $("adminIntro").hidden = panelId === "sessionPanel";
    $("signOutButton").hidden = !state.client || panelId === "signInForm" || panelId === "unavailablePanel";
    const first = $(panelId).querySelector("input");
    if (first) first.focus();
  }

  function setStatus(message, tone = "info") {
    $("adminStatus").textContent = message;
    $("adminStatus").dataset.tone = tone;
  }

  function setBusy(form, busy) {
    state.busy = busy;
    for (const control of form.querySelectorAll("input, button")) control.disabled = busy;
  }

  function errorText(error) {
    // Supabase Auth messages are generic ("Invalid login credentials"); never
    // echo tokens or factor secrets.
    return error?.message ? String(error.message).slice(0, 200) : "Something went wrong. Try again.";
  }

  async function callAdmin(path, { method = "GET", body, headers = {} } = {}) {
    const { data } = await state.client.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { ok: false, status: 401, code: "UNAUTHORIZED" };
    let response;
    try {
      response = await fetch(`${config.apiBaseUrl}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      return { ok: false, status: 0, code: "NETWORK_ERROR" };
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        code: payload?.error?.code || `HTTP_${response.status}`,
        message: payload?.error?.message,
        requestId: payload?.error?.requestId,
      };
    }
    return { ok: true, status: response.status, body: payload };
  }

  // Disable and restore need a sign-in within 15 minutes; a fresh password +
  // authenticator sign-in issues a new token.
  async function requireReauth() {
    await state.client.auth.signOut();
    setStatus("For this action, sign in again with your password and authenticator code.", "error");
    show("signInForm");
  }

  async function showSession() {
    const result = await callAdmin("/api/v1/admin/session");
    if (!result.ok) {
      const reason = {
        FORBIDDEN: "This account is not permitted to use Admin.",
        MFA_REQUIRED: "Verify your authenticator code first.",
        FEATURE_UNAVAILABLE: "Admin is not configured on the server.",
      }[result.code] || "Admin session could not be confirmed.";
      setStatus(`${reason}${result.requestId ? ` (Ref ${result.requestId.slice(0, 8)})` : ""}`, "error");
      if (result.code === "MFA_REQUIRED") return routeByAssurance();
      show("signInForm");
      return;
    }
    $("sessionEnvironment").textContent = result.body.environment;
    $("sessionAssurance").textContent = result.body.assuranceLevel === "aal2" ? "Password + authenticator" : result.body.assuranceLevel;
    $("sessionRecent").textContent = result.body.recentAuth ? "Yes (within 15 minutes)" : "No — sign in again before disable or restore";
    $("sessionExpires").textContent = new Date(result.body.expiresAt).toLocaleString();
    setStatus("Signed in.");
    show("sessionPanel");
    window.op4nAdminTools?.start({ callAdmin, requireReauth, setStatus });
  }

  async function routeByAssurance() {
    const { data, error } = await state.client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) {
      setStatus(errorText(error), "error");
      show("signInForm");
      return;
    }
    if (data.currentLevel === "aal2") return showSession();
    const factors = await state.client.auth.mfa.listFactors();
    const verified = factors.data?.totp?.find((factor) => factor.status === "verified");
    if (verified) {
      state.enrollFactorId = verified.id;
      setStatus("Enter the code from your authenticator app.");
      show("challengeForm");
      return;
    }
    // Remove abandoned unverified factors so enrollment can start cleanly.
    for (const factor of factors.data?.all || []) {
      if (factor.status !== "verified") await state.client.auth.mfa.unenroll({ factorId: factor.id });
    }
    const enrolled = await state.client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Op4n Admin" });
    if (enrolled.error) {
      setStatus(errorText(enrolled.error), "error");
      return;
    }
    state.enrollFactorId = enrolled.data.id;
    $("enrollQr").src = enrolled.data.totp.qr_code;
    $("enrollSecret").textContent = enrolled.data.totp.secret;
    setStatus("Set up your authenticator to finish signing in.");
    show("enrollForm");
  }

  async function verifyCode(form, input) {
    const code = input.value.trim();
    if (!/^\d{6}$/.test(code)) {
      setStatus("Enter the 6-digit code.", "error");
      input.focus();
      return;
    }
    setBusy(form, true);
    const { error } = await state.client.auth.mfa.challengeAndVerify({ factorId: state.enrollFactorId, code });
    setBusy(form, false);
    if (error) {
      setStatus(errorText(error), "error");
      input.select();
      return;
    }
    input.value = "";
    $("enrollSecret").textContent = "";
    $("enrollQr").removeAttribute("src");
    await showSession();
  }

  function init() {
    const env = config.environment || "local";
    $("adminEnvironment").textContent = env.charAt(0).toUpperCase() + env.slice(1);
    $("adminEnvironment").dataset.env = env;
    if (!config.authUrl || !config.publishableKey || !config.apiBaseUrl || !window.supabase?.createClient) {
      show("unavailablePanel");
      return;
    }
    state.client = window.supabase.createClient(config.authUrl, config.publishableKey, {
      auth: { persistSession: true, storageKey: `op4n-admin-${env}`, detectSessionInUrl: false },
    });

    $("signInForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.busy) return;
      const form = event.currentTarget;
      const email = $("adminEmail").value.trim();
      const password = $("adminPassword").value;
      if (!email || !password) {
        setStatus("Enter your email and password.", "error");
        return;
      }
      setBusy(form, true);
      const { error } = await state.client.auth.signInWithPassword({ email, password });
      setBusy(form, false);
      $("adminPassword").value = "";
      if (error) {
        setStatus(errorText(error), "error");
        $("adminPassword").focus();
        return;
      }
      await routeByAssurance();
    });
    $("enrollForm").addEventListener("submit", (event) => {
      event.preventDefault();
      if (!state.busy) void verifyCode(event.currentTarget, $("enrollCode"));
    });
    $("challengeForm").addEventListener("submit", (event) => {
      event.preventDefault();
      if (!state.busy) void verifyCode(event.currentTarget, $("challengeCode"));
    });
    $("signOutButton").addEventListener("click", async () => {
      await state.client.auth.signOut();
      setStatus("Signed out.");
      show("signInForm");
    });

    state.client.auth.getSession().then(({ data }) => {
      if (data.session) void routeByAssurance();
      else show("signInForm");
    });
  }

  init();
})();
