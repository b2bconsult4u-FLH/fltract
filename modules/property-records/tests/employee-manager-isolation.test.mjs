import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../../workers/admin/worker.mjs", import.meta.url), "utf8");
function loadFunction(start, end, name, dependencies = {}) {
  const body = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  assert.ok(body.startsWith(start), "Expected function found: " + name);
  return runInNewContext(body + "\n" + name, dependencies);
}
const canActOnWork = loadFunction("function canActOnWork(", "async function completeMiniCompResearchWork", "canActOnWork", {
  trainingManagerAuthorized: () => false
});
const staffCan = loadFunction("function staffCan(", "async function activeStaffUsers", "staffCan");
const employee = (id) => ({ authenticated: true, email: "employee" + id + "@example.invalid", user: { id, active: 1, role: "Employee" } });
const task = (id) => ({ assigned_staff_user_id: id, assigned_staff_email: "employee" + id + "@example.invalid" });

test("employees can work only on their own assigned tasks", () => {
  assert.equal(canActOnWork(employee(101), task(101)), true);
  assert.equal(canActOnWork(employee(102), task(102)), true);
  assert.equal(canActOnWork(employee(101), task(102)), false);
  assert.equal(canActOnWork(employee(102), task(101)), false);
});
test("employees cannot manage staff or assignments", () => {
  assert.equal(staffCan(employee(101).user, "manage_staff"), false);
  assert.equal(staffCan(employee(101).user, "manage_assignments"), false);
});
test("manager scope is NOT established merely by role", () => {
  // Current code must NOT be treated as full manager/team isolation.
  // Follow-on route and SQL tests must prove per-team visibility before release.
  assert.equal(staffCan({ id: 201, role: "Manager", active: 1 }, "manage_assignments"), true);
});
