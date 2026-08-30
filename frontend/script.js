// Relative URL: frontend is served by the same FastAPI app (same-origin),
// so there's no cross-origin preflight (OPTIONS) round-trip before every request.
const API_URL = "/predict";
const REQUEST_TIMEOUT_MS = 10000;

const STATUS_ICONS = {
  good: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="9" />
    <path d="M9 12l2 2 4-4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>`,
  warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M12 9v4M12 17h.01" stroke-linecap="round" />
  </svg>`,
  critical: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86L7.86 2z" stroke-linejoin="round" />
    <path d="M12 8v4M12 16h.01" stroke-linecap="round" />
  </svg>`,
};

// Metrics shown as individual meters ("a ratio against a limit") in the
// lifestyle snapshot - each has its own unit/range, so each gets its own
// same-ramp meter rather than being forced onto one shared bar-chart axis.
const SNAPSHOT_METRICS = [
  { label: "Daily usage", unit: "hrs/day", min: 1, max: 8.8, getValue: () => Number(fields.usageHours.value) },
  { label: "Daily unlocks", unit: "/day", min: 62, max: 273, getValue: () => Number(fields.unlocks.value) },
  { label: "Study time", unit: "hrs/day", min: 0.3, max: 8.3, getValue: () => Number(fields.studyHours.value) },
  { label: "Physical activity", unit: "hrs/day", min: 0, max: 4.1, getValue: () => Number(fields.activityHours.value) },
  { label: "Sleep", unit: "hrs/night", min: 3.6, max: 9.9, getValue: () => Number(fields.sleepHours.value) },
];

const form = document.getElementById("predict-form");
const submitBtn = document.getElementById("submit-btn");
const errorEl = document.getElementById("error");

const dashboardEmpty = document.getElementById("dashboard-empty");
const dashboardContent = document.getElementById("dashboard-content");
const chipsEl = document.getElementById("profile-chips");
const scoreEl = document.getElementById("result-score");
const badgeEl = document.getElementById("result-badge");
const badgeIconEl = document.getElementById("result-badge-icon");
const badgeLabelEl = document.getElementById("result-badge-label");
const scoreMeterEl = document.querySelector(".meter--score");
const scoreMeterFillEl = document.getElementById("score-meter-fill");
const snapshotListEl = document.getElementById("snapshot-list");
const snapshotTableBody = document.querySelector("#snapshot-table tbody");
const tableToggleBtn = document.getElementById("table-toggle");
const tableWrapEl = document.getElementById("snapshot-table-wrap");

// Cache field references once instead of re-querying the DOM on every submit.
const fields = {
  age: document.getElementById("age"),
  gender: document.getElementById("gender"),
  country: document.getElementById("country"),
  academicLevel: document.getElementById("academic_level"),
  platform: document.getElementById("platform"),
  purpose: document.getElementById("purpose"),
  usageHours: document.getElementById("usage_hours"),
  unlocks: document.getElementById("unlocks"),
  studyHours: document.getElementById("study_hours"),
  activityHours: document.getElementById("activity_hours"),
  sleepHours: document.getElementById("sleep_hours"),
  stress: document.getElementById("stress"),
};

// Tracks the in-flight request so a new submit can cancel a stale one
// instead of letting both race and wasting a completed response.
let activeController = null;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function classifyScore(score) {
  if (score >= 7) return { tier: "good", label: "Healthy range" };
  if (score >= 5) return { tier: "warning", label: "Moderate strain" };
  return { tier: "critical", label: "High strain" };
}

function classifyStress(level) {
  if (level === "Low") return "good";
  if (level === "High") return "warning";
  if (level === "Very High") return "critical";
  return null; // Medium: neutral, no status tint
}

function getPayload() {
  return {
    Age: Number(fields.age.value),
    Gender: fields.gender.value,
    Country: fields.country.value.trim(),
    Academic_Level: fields.academicLevel.value,
    Most_Used_Platform: fields.platform.value,
    Purpose_Of_Use: fields.purpose.value,
    Avg_Daily_Usage_Hours: Number(fields.usageHours.value),
    Daily_Unlocks: Number(fields.unlocks.value),
    Study_Hours: Number(fields.studyHours.value),
    Physical_Activity_Hours: Number(fields.activityHours.value),
    Sleep_Hours_Per_Night: Number(fields.sleepHours.value),
    Stress_Level: fields.stress.value,
  };
}

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError() {
  errorEl.hidden = true;
}

// FastAPI's 422 validation errors send `detail` as an ARRAY of
// {loc, msg} objects, not a string - stringifying that array directly
// (e.g. via `new Error(detail)`) collapses each object to "[object Object]".
// Our own HTTPException (e.g. the 500 from /predict) sends `detail` as a
// plain string, so that path still works unchanged.
function extractErrorMessage(payload, status) {
  const detail = payload?.detail;

  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        const field = Array.isArray(e.loc) ? e.loc.slice(1).join(".") : "";
        return field ? `${field}: ${e.msg}` : e.msg;
      })
      .join(" · ");
  }

  return `Request failed with status ${status}`;
}

function makeChip(text, tier) {
  const li = document.createElement("li");
  li.className = "chip" + (tier ? ` chip--${tier}` : "");
  li.textContent = text;
  return li;
}

function renderProfileChips(payload) {
  chipsEl.innerHTML = "";
  chipsEl.append(
    makeChip(payload.Gender),
    makeChip(payload.Country),
    makeChip(payload.Academic_Level),
    makeChip(payload.Most_Used_Platform),
    makeChip(payload.Purpose_Of_Use),
    makeChip(`Stress: ${payload.Stress_Level}`, classifyStress(payload.Stress_Level))
  );
}

function renderScore(score) {
  const { tier, label } = classifyScore(score);

  scoreEl.textContent = score.toFixed(2);

  badgeEl.classList.remove("badge--good", "badge--warning", "badge--critical");
  badgeEl.classList.add(`badge--${tier}`);
  badgeIconEl.innerHTML = STATUS_ICONS[tier];
  badgeLabelEl.textContent = label;

  scoreMeterEl.classList.remove("is-good", "is-warning", "is-critical");
  scoreMeterEl.classList.add(`is-${tier}`);
  scoreMeterFillEl.style.width = `${clamp((score / 10) * 100, 0, 100)}%`;
}

function renderSnapshot() {
  snapshotListEl.innerHTML = "";
  snapshotTableBody.innerHTML = "";

  for (const metric of SNAPSHOT_METRICS) {
    const value = metric.getValue();
    const percent = clamp(
      ((value - metric.min) / (metric.max - metric.min)) * 100,
      0,
      100
    );
    const displayValue = Number.isInteger(value) ? value : value.toFixed(1);

    const li = document.createElement("li");
    li.className = "meter-row";
    li.innerHTML = `
      <div class="meter-row__top">
        <span class="meter-row__label">${metric.label}</span>
        <span class="meter-row__value">${displayValue} ${metric.unit}</span>
      </div>
      <div class="meter__track">
        <div class="meter__fill" style="width:${percent}%"></div>
      </div>
    `;
    snapshotListEl.appendChild(li);

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${metric.label}</td>
      <td>${displayValue} ${metric.unit}</td>
      <td>${metric.min}–${metric.max} ${metric.unit}</td>
    `;
    snapshotTableBody.appendChild(row);
  }
}

tableToggleBtn.addEventListener("click", () => {
  const showingTable = !tableWrapEl.hidden;
  tableWrapEl.hidden = showingTable;
  snapshotListEl.hidden = !showingTable;
  tableToggleBtn.setAttribute("aria-pressed", String(!showingTable));
  tableToggleBtn.textContent = showingTable ? "View as table" : "View as chart";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  // Cancel any request still in flight from a previous submit.
  if (activeController) {
    activeController.abort();
  }
  const controller = new AbortController();
  activeController = controller;
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  submitBtn.disabled = true;
  submitBtn.textContent = "Predicting...";

  const payload = getPayload();

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(extractErrorMessage(payload, response.status));
    }

    const data = await response.json();

    clearError();
    dashboardEmpty.hidden = true;
    dashboardContent.hidden = false;

    renderProfileChips(payload);
    renderScore(data.predicted_mental_health_score);
    renderSnapshot();
  } catch (err) {
    if (err.name === "AbortError") {
      showError("Request timed out or was cancelled. Try again.");
    } else if (err.message === "Failed to fetch") {
      showError("Could not reach the API. Is the server running?");
    } else {
      showError(err.message);
    }
  } finally {
    clearTimeout(timeoutId);
    if (activeController === controller) {
      activeController = null;
    }
    submitBtn.disabled = false;
    submitBtn.textContent = "Predict Score";
  }
});
