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

const canAccessWorkRecord = loadFunction("async function canAccessWorkRecord(", "function canActOnWork(", "canAccessWorkRecord");
const manager = (id) => ({ authenticated: true, email: "manager"+id+"@example.invalid", user: { id, active: 1, role: "Manager" } });
const fakeDb = (allowed) => ({ DB: { prepare(sql) {
  assert.match(sql, /staff_teams/);
  return { bind(...args) { return { async first() { return allowed ? {ok:1} : null; } }; } };
} } });
test("managers cannot view unrelated team tasks", async () => {
  assert.equal(await canAccessWorkRecord(fakeDb(false), manager(201), task(101)), false);
  assert.equal(await canAccessWorkRecord(fakeDb(true), manager(201), task(101)), true);
  assert.equal(await canAccessWorkRecord(fakeDb(false), manager(201), task(201)), true);
});
test("employees and CFO cannot view other assigned work", async () => {
  assert.equal(await canAccessWorkRecord(fakeDb(true), employee(101), task(102)), false);
  const cfo = {...employee(301),user:{id:301,active:1,role:"CFO"}};
  assert.equal(await canAccessWorkRecord(fakeDb(true), cfo, task(102)), false);
});
test("managers do not inherit global work access by title", () => {
  assert.equal(canActOnWork(manager(201), task(101)), false);
});
