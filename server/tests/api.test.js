import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createServer } from "../app.js";

let baseUrl;
let server;

async function startServer() {
  const { server: httpServer } = createServer({ token: "test-token", dbPath: ":memory:" });
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

async function request(method, path, body, token = "test-token") {
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

test("requires auth", async () => {
  const { status, payload } = await request("GET", "/people", null, "");
  assert.equal(status, 401);
  assert.ok(payload.error);
});

test("people + shifts flow", async () => {
  const create = await request("POST", "/people", { person_name: "Alice" });
  assert.equal(create.status, 201);
  const personId = create.payload.id;
  assert.ok(create.payload.person_name_b64);

  const start = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  const shift = await request("POST", "/shifts", {
    person_id: personId,
    start_at: start,
    end_at: end,
  });
  assert.equal(shift.status, 201);

  const list = await request("GET", "/shifts");
  assert.equal(list.status, 200);
  assert.equal(list.payload.shifts.length, 1);

  const denyDelete = await request("DELETE", `/people/${personId}`);
  assert.equal(denyDelete.status, 409);

  const deletedShift = await request("DELETE", `/shifts/${shift.payload.id}`);
  assert.equal(deletedShift.status, 204);

  const deletedPerson = await request("DELETE", `/people/${personId}`);
  assert.equal(deletedPerson.status, 204);
});

test("invalid shifts", async () => {
  const create = await request("POST", "/people", { person_name: "Bob" });
  const personId = create.payload.id;

  const start = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  const missing = await request("POST", "/shifts", {
    person_id: "missing",
    start_at: start,
    end_at: end,
  });
  assert.equal(missing.status, 400);

  const invalidTime = await request("POST", "/shifts", {
    person_id: personId,
    start_at: start,
    end_at: new Date(Date.now() - 60 * 1000).toISOString(),
  });
  assert.equal(invalidTime.status, 400);
});

test("lists only upcoming", async () => {
  const create = await request("POST", "/people", { person_name: "Carol" });
  const personId = create.payload.id;

  const pastStart = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const pastEnd = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
  const futureStart = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const futureEnd = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  const past = await request("POST", "/shifts", {
    person_id: personId,
    start_at: pastStart,
    end_at: pastEnd,
  });
  assert.equal(past.status, 201);

  const future = await request("POST", "/shifts", {
    person_id: personId,
    start_at: futureStart,
    end_at: futureEnd,
  });
  assert.equal(future.status, 201);

  const list = await request("GET", "/shifts");
  assert.equal(list.status, 200);
  assert.equal(list.payload.shifts.length, 1);
});
