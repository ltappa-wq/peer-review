/**
 * Anonymous Peer Review Survey — Backend (zero native deps)
 *
 * Stack: Node.js + Express. Storage is a single JSON file — no database engine, no compilation required.
 *
 * Anonymity model:
 *   - Each employee gets two opaque tokens: a survey_token (for submitting) and a results_token (for viewing their own results).
 *   - On submit, we mark the survey_token as "used" (so it can only be used once), but we DO NOT store the submitter id
 *     alongside any rating or comment. Ratings are appended as { rateeId, valueId, rating }. Comments are appended as
 *     { rateeId, comment }. There is no field or timestamp that links a row back to the submitter.
 *   - Comments are returned in a shuffled order so ordering can't hint at submitter identity.
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "peer-review.json");

// ---------- Storage ----------
function emptyStore() {
  return {
    employees: [],   // { id, name, email, surveyToken, resultsToken, submitted }
    coreValues: [],  // { id, name }
    ratings: [],     // { rateeId, valueId, rating }    <-- NO submitter field
    comments: [],    // { rateeId, comment }            <-- NO submitter field
    seq: { employee: 0, value: 0 },
  };
}

fs.mkdirSync(DATA_DIR, { recursive: true });

let store = emptyStore();
if (fs.existsSync(DB_PATH)) {
  try {
    store = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  } catch (err) {
    console.error("Failed to read data file, starting fresh:", err.message);
    store = emptyStore();
  }
}

function save() {
  // Atomic-ish write: write to temp then rename.
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function nextId(kind) {
  store.seq[kind] = (store.seq[kind] || 0) + 1;
  return store.seq[kind];
}

function genToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function isAdminAllowed(req) {
  const required = process.env.ADMIN_TOKEN;
  if (!required) return true;
  const provided = req.query.admin_token || req.headers["x-admin-token"];
  return provided && provided === required;
}

// ---------- App ----------
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// -------------------------------------------------------------
// Admin endpoints
// -------------------------------------------------------------

/**
 * POST /api/admin/setup
 * Body: { employees: [{name, email}], coreValues: ["Integrity", ...], reset?: boolean }
 */
app.post("/api/admin/setup", (req, res) => {
  if (!isAdminAllowed(req)) return res.status(401).json({ error: "Unauthorized" });

  const { employees, coreValues, reset } = req.body || {};
  if (!Array.isArray(employees) || employees.length < 2) {
    return res.status(400).json({ error: "Provide at least 2 employees." });
  }
  if (!Array.isArray(coreValues) || coreValues.length < 1) {
    return res.status(400).json({ error: "Provide at least 1 core value." });
  }
  for (const e of employees) {
    if (!e || typeof e.name !== "string" || typeof e.email !== "string" || !e.name.trim() || !e.email.trim()) {
      return res.status(400).json({ error: "Each employee needs a non-empty name and email." });
    }
  }

  if (reset) store = emptyStore();

  // Check for duplicate emails against existing
  const existingEmails = new Set(store.employees.map((e) => e.email.toLowerCase()));
  for (const e of employees) {
    const em = e.email.trim().toLowerCase();
    if (existingEmails.has(em)) {
      return res.status(400).json({
        error: `Email already exists: ${em}. Use reset to start fresh, or remove duplicates.`,
      });
    }
  }

  // Add core values (dedupe by name)
  const existingValueNames = new Set(store.coreValues.map((v) => v.name.toLowerCase()));
  for (const v of coreValues) {
    const name = String(v).trim();
    if (!name) continue;
    if (existingValueNames.has(name.toLowerCase())) continue;
    store.coreValues.push({ id: nextId("value"), name });
    existingValueNames.add(name.toLowerCase());
  }

  // Add employees
  for (const e of employees) {
    store.employees.push({
      id: nextId("employee"),
      name: e.name.trim(),
      email: e.email.trim().toLowerCase(),
      surveyToken: genToken(),
      resultsToken: genToken(),
      submitted: false,
    });
  }

  save();

  const base = getBaseUrl(req);
  const sorted = [...store.employees].sort((a, b) => a.name.localeCompare(b.name));
  res.json({
    ok: true,
    employees: sorted.map((r) => ({
      name: r.name,
      email: r.email,
      surveyLink: `${base}/s/${r.surveyToken}`,
      resultsLink: `${base}/r/${r.resultsToken}`,
    })),
    coreValues: store.coreValues.map((v) => v.name),
  });
});

/**
 * GET /api/admin/links
 */
app.get("/api/admin/links", (req, res) => {
  if (!isAdminAllowed(req)) return res.status(401).json({ error: "Unauthorized" });
  const base = getBaseUrl(req);
  const sorted = [...store.employees].sort((a, b) => a.name.localeCompare(b.name));
  res.json({
    employees: sorted.map((r) => ({
      name: r.name,
      email: r.email,
      submitted: !!r.submitted,
      surveyLink: `${base}/s/${r.surveyToken}`,
      resultsLink: `${base}/r/${r.resultsToken}`,
    })),
  });
});

// -------------------------------------------------------------
// Survey endpoints
// -------------------------------------------------------------

app.get("/api/survey/:token", (req, res) => {
  const emp = store.employees.find((e) => e.surveyToken === req.params.token);
  if (!emp) return res.status(404).json({ error: "Invalid survey link." });
  if (emp.submitted) return res.status(410).json({ error: "This survey has already been submitted." });

  const others = store.employees.filter((e) => e.id !== emp.id).map((e) => ({ id: e.id, name: e.name }));
  others.sort((a, b) => a.name.localeCompare(b.name));
  const values = store.coreValues.map((v) => ({ id: v.id, name: v.name }));

  res.json({ respondentName: emp.name, employees: others, coreValues: values });
});

app.post("/api/survey/:token", (req, res) => {
  const emp = store.employees.find((e) => e.surveyToken === req.params.token);
  if (!emp) return res.status(404).json({ error: "Invalid survey link." });
  if (emp.submitted) return res.status(410).json({ error: "This survey has already been submitted." });

  const { ratings, comments } = req.body || {};
  if (!Array.isArray(ratings)) return res.status(400).json({ error: "ratings must be an array." });

  const validRatings = new Set(["+", "+/-", "-"]);
  const validEmpIds = new Set(store.employees.filter((e) => e.id !== emp.id).map((e) => e.id));
  const validValueIds = new Set(store.coreValues.map((v) => v.id));

  for (const r of ratings) {
    if (!r || !validEmpIds.has(r.rateeId) || !validValueIds.has(r.valueId) || !validRatings.has(r.rating)) {
      return res.status(400).json({ error: "Invalid rating payload." });
    }
  }
  if (comments && !Array.isArray(comments)) {
    return res.status(400).json({ error: "comments must be an array." });
  }

  // Anonymously append — no submitter field is ever recorded.
  for (const r of ratings) {
    store.ratings.push({ rateeId: r.rateeId, valueId: r.valueId, rating: r.rating });
  }
  if (Array.isArray(comments)) {
    for (const c of comments) {
      if (!c || !validEmpIds.has(c.rateeId)) continue;
      const text = typeof c.comment === "string" ? c.comment.trim() : "";
      if (text) store.comments.push({ rateeId: c.rateeId, comment: text });
    }
  }
  emp.submitted = true;
  save();

  res.json({ ok: true });
});

// -------------------------------------------------------------
// Results endpoints
// -------------------------------------------------------------

/**
 * GET /api/admin/all-results — every employee's aggregated results.
 * Protected by ADMIN_TOKEN (when set). Use the all-results link to view in the browser.
 */
app.get("/api/admin/all-results", (req, res) => {
  if (!isAdminAllowed(req)) return res.status(401).json({ error: "Unauthorized" });
  const sortedEmployees = [...store.employees].sort((a, b) => a.name.localeCompare(b.name));
  const all = sortedEmployees.map((emp) => {
    const byValue = store.coreValues.map((v) => {
      const row = { value: v.name, "+": 0, "+/-": 0, "-": 0 };
      for (const r of store.ratings) {
        if (r.rateeId === emp.id && r.valueId === v.id) row[r.rating]++;
      }
      return row;
    });
    const comments = store.comments.filter((c) => c.rateeId === emp.id).map((c) => c.comment);
    for (let i = comments.length - 1; i > 0; i--) {
      const j = crypto.randomInt(0, i + 1);
      [comments[i], comments[j]] = [comments[j], comments[i]];
    }
    return { name: emp.name, ratingsByValue: byValue, comments };
  });
  res.json({ employees: all });
});

app.get("/api/results/:token", (req, res) => {
  const emp = store.employees.find((e) => e.resultsToken === req.params.token);
  if (!emp) return res.status(404).json({ error: "Invalid results link." });

  const byValue = store.coreValues.map((v) => {
    const row = { value: v.name, "+": 0, "+/-": 0, "-": 0 };
    for (const r of store.ratings) {
      if (r.rateeId === emp.id && r.valueId === v.id) row[r.rating]++;
    }
    return row;
  });

  const comments = store.comments.filter((c) => c.rateeId === emp.id).map((c) => c.comment);
  // Fisher-Yates shuffle so order can't hint at submitter identity.
  for (let i = comments.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [comments[i], comments[j]] = [comments[j], comments[i]];
  }

  res.json({ name: emp.name, ratingsByValue: byValue, comments });
});

// -------------------------------------------------------------
// Page routes
// -------------------------------------------------------------
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));
app.get("/s/:token", (_req, res) => res.sendFile(path.join(__dirname, "public", "survey.html")));
app.get("/r/:token", (_req, res) => res.sendFile(path.join(__dirname, "public", "results.html")));
app.get("/all-results", (_req, res) => res.sendFile(path.join(__dirname, "public", "all-results.html")));

app.listen(PORT, () => {
  console.log(`Peer Review app running on http://localhost:${PORT}`);
  if (!process.env.ADMIN_TOKEN) {
    console.log("NOTE: ADMIN_TOKEN env var not set — admin endpoints are OPEN. Set one for production.");
  }
});
