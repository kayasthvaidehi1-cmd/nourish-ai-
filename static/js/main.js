/**
 * NourishSync AI — main.js
 * Handles SPA navigation, AJAX calls to Flask endpoints,
 * real-time metric/feed/alert updates, and form submission.
 */

// ── Clock ────────────────────────────────────────────────────────────────────
(function startClock() {
  const el = document.getElementById("clock");
  function tick() {
    el.textContent = new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
    });
  }
  tick();
  setInterval(tick, 1000);
})();

// ── SPA Navigation ───────────────────────────────────────────────────────────
const navLinks  = document.querySelectorAll(".nav-link");
const sections  = document.querySelectorAll(".section");

navLinks.forEach(link => {
  link.addEventListener("click", e => {
    e.preventDefault();
    const target = link.dataset.section;

    navLinks.forEach(l => l.classList.remove("active"));
    sections.forEach(s => s.classList.remove("active"));

    link.classList.add("active");
    const sec = document.getElementById(target);
    if (sec) sec.classList.add("active");

    // Lazy-load data for the activated section
    if (target === "metrics") fetchMetrics();
    if (target === "feed")    fetchDonations();
    if (target === "alerts")  fetchAlerts();
  });
});

// ── Utility: JSON fetch wrapper ───────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  const defaults = {
    headers: { "Content-Type": "application/json" },
  };
  const res = await fetch(url, Object.assign(defaults, opts));
  return res.json();
}

// ── Metrics ───────────────────────────────────────────────────────────────────
async function fetchMetrics() {
  try {
    const d = await apiFetch("/api/metrics");
    animateCount("m-rescued",  d.total_rescued);
    animateCount("m-active",   d.active_posts);
    animateCount("m-claims",   d.verified_claims);
    animateCount("m-critical", d.critical_expiry_rate, "%");
  } catch (err) {
    console.error("Metrics fetch error:", err);
  }
}

function animateCount(id, target, suffix = "") {
  const el = document.getElementById(id);
  if (!el) return;
  const start   = 0;
  const end     = parseFloat(target) || 0;
  const dur     = 700;
  const step    = 16;
  const steps   = dur / step;
  const inc     = end / steps;
  let   current = start;
  const timer   = setInterval(() => {
    current += inc;
    if (current >= end) {
      clearInterval(timer);
      el.textContent = end + suffix;
    } else {
      el.textContent = (Number.isInteger(end)
        ? Math.round(current)
        : current.toFixed(1)) + suffix;
    }
  }, step);
}

// ── Donation Feed ─────────────────────────────────────────────────────────────
async function fetchDonations() {
  const tbody = document.getElementById("donation-tbody");
  tbody.innerHTML = `<tr><td colspan="10" class="empty-row">Loading…</td></tr>`;
  try {
    const donations = await apiFetch("/api/donations");
    renderDonationTable(donations);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-row" style="color:#ef4444">Failed to load feed.</td></tr>`;
    console.error(err);
  }
}

function renderDonationTable(donations) {
  const tbody = document.getElementById("donation-tbody");
  if (!donations.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-row">No donations yet. Be the first to donate!</td></tr>`;
    return;
  }
  tbody.innerHTML = donations.map(d => {
    const sl     = d.shelf_life;
    const risk   = sl.perishability_risk;
    const riskCl = `risk--${risk.toLowerCase()}`;
    const stBadge = statusBadge(d.status);
    const claimed = d.status !== "Available";
    return `
      <tr>
        <td><strong>${esc(d.donor_name)}</strong><br><small style="color:var(--muted)">${esc(d.pincode)}</small></td>
        <td>${esc(d.category)}</td>
        <td>${esc(d.food_name)}</td>
        <td>${d.quantity} kg/srv</td>
        <td>${esc(d.meal_type)}</td>
        <td>${esc(d.storage)}</td>
        <td style="font-variant-numeric:tabular-nums">${sl.remaining_hours}h</td>
        <td><span class="${riskCl}">${risk}</span></td>
        <td>${stBadge}</td>
        <td>
          <button class="btn btn--claim" data-id="${esc(d.id)}" ${claimed ? "disabled" : ""}>
            ${claimed ? "✓ Claimed" : "Claim Surplus"}
          </button>
        </td>
      </tr>`;
  }).join("");

  // Wire up claim buttons
  tbody.querySelectorAll(".btn--claim:not([disabled])").forEach(btn => {
    btn.addEventListener("click", () => claimDonation(btn.dataset.id, btn));
  });
}

function statusBadge(status) {
  const map = {
    Available:  "badge--available",
    Claimed:    "badge--claimed",
    Dispatched: "badge--dispatched",
    Expired:    "badge--expired",
  };
  return `<span class="badge ${map[status] || ''}">${status}</span>`;
}

async function claimDonation(id, btn) {
  btn.disabled = true;
  btn.textContent = "Claiming…";
  try {
    const res = await apiFetch(`/api/claim/${id}`, { method: "POST" });
    if (res.success) {
      fetchDonations();
      fetchMetrics();
    } else {
      btn.textContent = res.error || "Error";
    }
  } catch (err) {
    btn.textContent = "Error";
    console.error(err);
  }
}

// ── Alerts ────────────────────────────────────────────────────────────────────
async function fetchAlerts() {
  try {
    const alerts = await apiFetch("/api/alerts");
    renderAlerts(alerts);
  } catch (err) {
    console.error("Alert fetch error:", err);
  }
}

function renderAlerts(alerts) {
  const list = document.getElementById("alert-list");
  if (!alerts.length) {
    list.innerHTML = `<li class="alert-empty">No alerts yet. Alerts are triggered for Medium &amp; Critical perishability donations.</li>`;
    return;
  }
  list.innerHTML = alerts.map(a => {
    const dt  = new Date(a.timestamp);
    const ts  = dt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
    const lvl = a.level.toLowerCase();
    return `
      <li class="alert-item">
        <span class="alert-time">${ts}</span>
        <span class="alert-level alert-level--${lvl}">${a.level}</span>
        <span class="alert-msg">${esc(a.message)}</span>
      </li>`;
  }).join("");
}

// ── Donate Form ───────────────────────────────────────────────────────────────
const donateForm    = document.getElementById("donate-form");
const formFeedback  = document.getElementById("form-feedback");
const shelfResult   = document.getElementById("shelf-result");

// Pre-fill cooking timestamp to "now" as a convenience default
(function prefillTimestamp() {
  const el  = document.getElementById("cooking_timestamp");
  if (!el) return;
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  el.value  = now.toISOString().slice(0, 16);
})();

donateForm.addEventListener("submit", async e => {
  e.preventDefault();
  hideFeedback();
  shelfResult.classList.add("hidden");

  const fd   = new FormData(donateForm);
  const body = {};
  fd.forEach((v, k) => { body[k] = v.trim(); });

  // Convert datetime-local to ISO 8601
  if (body.cooking_timestamp) {
    body.cooking_timestamp = new Date(body.cooking_timestamp).toISOString();
  }

  const submitBtn = donateForm.querySelector('[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = "Submitting…";

  try {
    const res = await apiFetch("/api/donate", {
      method: "POST",
      body:   JSON.stringify(body),
    });

    if (res.success) {
      showFeedback(`✅ Donation logged successfully! ID: ${res.donation.id.slice(0, 8)}…`, "success");
      renderShelfResult(res.donation.shelf_life);
      donateForm.reset();
      // Re-fill default timestamp after reset
      const el  = document.getElementById("cooking_timestamp");
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      el.value  = now.toISOString().slice(0, 16);
    } else {
      showFeedback(`❌ ${res.error || "Submission failed."}`, "error");
    }
  } catch (err) {
    showFeedback("❌ Network error. Please try again.", "error");
    console.error(err);
  } finally {
    submitBtn.disabled    = false;
    submitBtn.innerHTML   = '<span class="btn-icon">🚀</span> Submit Donation';
  }
});

function renderShelfResult(sl) {
  document.getElementById("sr-total").textContent    = sl.total_safe_hours + " hrs";
  document.getElementById("sr-elapsed").textContent  = sl.elapsed_hours + " hrs";
  document.getElementById("sr-remaining").textContent = sl.remaining_hours + " hrs";

  const riskEl = document.getElementById("sr-risk");
  riskEl.textContent  = sl.perishability_risk;
  riskEl.className    = `shelf-val risk--${sl.perishability_risk.toLowerCase()}`;
  shelfResult.classList.remove("hidden");
}

function showFeedback(msg, type) {
  formFeedback.textContent = msg;
  formFeedback.className   = `form-feedback ${type}`;
  formFeedback.classList.remove("hidden");
}

function hideFeedback() {
  formFeedback.classList.add("hidden");
}

// ── Refresh Buttons ───────────────────────────────────────────────────────────
document.getElementById("refresh-feed")?.addEventListener("click", fetchDonations);
document.getElementById("refresh-alerts")?.addEventListener("click", fetchAlerts);

// ── Escape HTML ───────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Auto-Polling (every 30s) ──────────────────────────────────────────────────
setInterval(() => {
  const active = document.querySelector(".section.active")?.id;
  if (active === "metrics") fetchMetrics();
  if (active === "feed")    fetchDonations();
  if (active === "alerts")  fetchAlerts();
}, 30_000);

// ── Initial Load ──────────────────────────────────────────────────────────────
fetchMetrics();
