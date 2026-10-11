import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { generateKeyPairSync, sign, webcrypto } from "node:crypto";

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

test("Access identity cannot be spoofed using an email header alone", async () => {
  const accessIdentity = loadFunction("const ACCESS_ISSUER =", "async function staffContext(", "accessIdentity", {
    Date, JSON, TextDecoder, TextEncoder, Uint8Array, atob, crypto: globalThis.crypto,
    AbortSignal, fetch: async () => { throw new Error("No external fetch expected"); }
  });
  const forged = { headers: { get(name) {
    return name === "Cf-Access-Authenticated-User-Email" ? "admin@example.invalid" : null;
  } } };
  assert.equal(await accessIdentity(forged), "");
  assert.equal(await accessIdentity({headers:{get:()=>null}}), "");
  assert.equal(await accessIdentity({headers:{get:name=>name==="Cf-Access-Jwt-Assertion"?"invalid.token.value":null}}), "");
});

test("a valid signed Cloudflare Access JWT authenticates and a tampered one fails", async () => {
  const {publicKey,privateKey} = generateKeyPairSync("rsa",{modulusLength:2048});
  const jwk = publicKey.export({format:"jwk"});
  jwk.kid="acceptance-key";
  const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now()/1000);
  const header = b64({alg:"RS256",kid:"acceptance-key",typ:"JWT"});
  const payload = b64({iss:"https://b2bconsult4u.cloudflareaccess.com",
    aud:["4312260f76753fb5e3464d1696f75069a27536a21048ae819ac63e79b46f198b"],
    email:"Admin@Example.Invalid",iat:now-30,exp:now+300});
  const body = header+"."+payload;
  const signature = sign("RSA-SHA256",Buffer.from(body),privateKey).toString("base64url");
  const token=body+"."+signature;
  let certRequests=0;
  const accessIdentity = loadFunction("const ACCESS_ISSUER =", "async function staffContext(", "accessIdentity", {
    Date,JSON,TextDecoder,TextEncoder,Uint8Array,atob,crypto:webcrypto,AbortSignal,
    fetch:async () => {certRequests++;return {ok:true,json:async()=>({keys:[jwk]})};}
  });
  const request = jwt => ({headers:{get:name=>name==="Cf-Access-Jwt-Assertion"?jwt:null}});
  assert.equal(await accessIdentity(request(token)),"admin@example.invalid");
  assert.equal(await accessIdentity(request(body+"."+signature.slice(0,-2)+"ab")),"");
  assert.equal(certRequests,1);
});
