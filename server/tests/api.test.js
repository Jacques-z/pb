import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { pbkdf2Sync } from "node:crypto";

import { createServer } from "../app.js";

const CLIENT_HASH_ITERATIONS = 100_000;
const CLIENT_HASH_BYTES = 32;

let baseUrl;
let server;
let db;

function clientHash(username, password) {
  return pbkdf2Sync(password, username, CLIENT_HASH_ITERATIONS, CLIENT_HASH_BYTES, "sha256").toString(
    "base64"
  );
}

async function startServer() {
  const result = createServer({ dbPath: ":memory:" });
  const { server: httpServer } = result;
  db = result.db;
  await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address();
  baseUrl = `http://${address.address}:${address.port}`;
  server = httpServer;
}

before(async () => {
  await startServer();
});

after(async () => {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
});

async function request(method, path, body, token) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : null;
  return { status: res.status, payload };
}

test("auth, user management, shifts, audit logs", async () => {
  const noAuth = await request("GET", "/people");
  assert.equal(noAuth.status, 401);

  const adminUsername = "admin";
  const adminPassword = "AdminPass123";
  const adminHash = clientHash(adminUsername, adminPassword);
  const bootstrap = await request("POST", "/auth/bootstrap", {
    username: adminUsername,
    password_client_hash: adminHash,
    person_name: "管理员",
  });
  assert.equal(bootstrap.status, 201);
  const adminToken = bootstrap.payload.token;

  const userUsername = "alice";
  const userPassword = "alicepass";
  const userHash = clientHash(userUsername, userPassword);
  const createUser = await request(
    "POST",
    "/users",
    {
      username: userUsername,
      password_client_hash: userHash,
      person_name: "Alice",
    },
    adminToken
  );
  assert.equal(createUser.status, 201);
  const userId = createUser.payload.id;

  const login = await request("POST", "/auth/login", {
    username: userUsername,
    password_client_hash: userHash,
  });
  assert.equal(login.status, 200);
  const userToken = login.payload.token;

  const listUsers = await request("GET", "/users", null, userToken);
  assert.equal(listUsers.status, 403);

  const people = await request("GET", "/people", null, userToken);
  assert.equal(people.status, 200);
  assert.ok(people.payload.people.find((person) => person.id === userId));

  const start = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const shift = await request(
    "POST",
    "/shifts",
    {
      person_id: userId,
      start_at: start,
      end_at: end,
    },
    userToken
  );
  assert.equal(shift.status, 201);

  const updateStart = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  const updateEnd = new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString();
  const updated = await request(
    "PUT",
    `/shifts/${shift.payload.id}`,
    {
      person_id: userId,
      start_at: updateStart,
      end_at: updateEnd,
    },
    userToken
  );
  assert.equal(updated.status, 200);

  const newPassword = "alicepass2";
  const newHash = clientHash(userUsername, newPassword);
  const changePassword = await request(
    "POST",
    "/auth/change-password",
    {
      current_password_client_hash: userHash,
      new_password_client_hash: newHash,
    },
    userToken
  );
  assert.equal(changePassword.status, 204);

  const expiredToken = await request("GET", "/shifts", null, userToken);
  assert.equal(expiredToken.status, 401);

  const relogin = await request("POST", "/auth/login", {
    username: userUsername,
    password_client_hash: newHash,
  });
  assert.equal(relogin.status, 200);
  const freshUserToken = relogin.payload.token;

  const auditCountBeforeRead = db
    .prepare("SELECT COUNT(1) AS count FROM audit_logs")
    .get().count;
  await request("GET", "/people", null, freshUserToken);
  const auditCountAfterRead = db
    .prepare("SELECT COUNT(1) AS count FROM audit_logs")
    .get().count;
  assert.equal(auditCountAfterRead, auditCountBeforeRead);

  const auditCountBeforeFail = db
    .prepare("SELECT COUNT(1) AS count FROM audit_logs")
    .get().count;
  const denyDelete = await request("DELETE", `/users/${userId}`, null, adminToken);
  assert.equal(denyDelete.status, 409);
  const auditCountAfterFail = db
    .prepare("SELECT COUNT(1) AS count FROM audit_logs")
    .get().count;
  assert.equal(auditCountAfterFail, auditCountBeforeFail);

  const deletedShift = await request(
    "DELETE",
    `/shifts/${shift.payload.id}`,
    null,
    freshUserToken
  );
  assert.equal(deletedShift.status, 204);

  const deletedUser = await request("DELETE", `/users/${userId}`, null, adminToken);
  assert.equal(deletedUser.status, 204);

  const actionRows = db
    .prepare("SELECT action FROM audit_logs ORDER BY occurred_at")
    .all()
    .map((row) => row.action);
  assert.ok(actionRows.includes("shifts.update"));
  assert.ok(actionRows.includes("users.create"));
});
