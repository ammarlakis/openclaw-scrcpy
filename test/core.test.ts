import test from "node:test";
import assert from "node:assert/strict";

import { NLPlanSchema, checkPlanSchema, resolveAllowedPackage, resolveCfg, validatePlan } from "../src/core.ts";

test("checkPlanSchema accepts a valid plan", () => {
  const plan = {
    version: 1,
    goal: "Take a screenshot",
    steps: [{ action: "screenshot", as: "path" }],
  };

  const out = checkPlanSchema(plan);
  assert.equal(out.version, 1);
  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0].action, "screenshot");
});

test("checkPlanSchema rejects invalid plan shape", () => {
  assert.throws(() => checkPlanSchema({ nope: true }), /schema validation/i);
});

test("validatePlan enforces maxSteps", () => {
  const cfg = resolveCfg({});
  const plan = checkPlanSchema({
    version: 1,
    goal: "Too long",
    steps: Array.from({ length: 3 }, () => ({ action: "wait", ms: 1 })),
  });

  assert.throws(() => validatePlan(plan, { maxSteps: 2, screen: { width: 100, height: 100 }, cfg }), /Plan too long/);
});

test("validatePlan enforces coordinate bounds", () => {
  const cfg = resolveCfg({});
  const plan = checkPlanSchema({
    version: 1,
    goal: "Out of bounds",
    steps: [{ action: "tap", x: 999, y: 0 }],
  });

  assert.throws(
    () => validatePlan(plan, { maxSteps: 20, screen: { width: 100, height: 100 }, cfg }),
    /out of bounds/i,
  );
});

test("validatePlan enforces open_app allowlist", () => {
  const cfg = resolveCfg({ apps: { allow: { whatsapp: "com.whatsapp" } } });

  const plan = checkPlanSchema({
    version: 1,
    goal: "Try a disallowed app",
    steps: [{ action: "open_app", app: "telegram" }],
  });

  assert.throws(
    () => validatePlan(plan, { maxSteps: 20, screen: { width: 100, height: 100 }, cfg }),
    /not allowlisted/i,
  );
});

test("resolveAllowedPackage allows friendly keys and allowlisted package names", () => {
  const allow = { chrome: "com.android.chrome" };
  assert.equal(resolveAllowedPackage("chrome", allow), "com.android.chrome");
  assert.equal(resolveAllowedPackage("com.android.chrome", allow), "com.android.chrome");
  assert.equal(resolveAllowedPackage("com.not.allowed", allow), "");
});
