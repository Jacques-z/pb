#!/usr/bin/env node
import http from "node:http";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const DEFAULTS = {
  host: "127.0.0.1",
  port: 8787,
  dbPath: "server/data.db",
  token: "dev-token",
};

function utcNow() {
  return new Date().toISOString();
}

function encodeName(name) {
  return Buffer.from(name, "utf8").toString("base64");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("invalid json"));
      }
    });
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendEmpty(res, status) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
  });
  res.end();
}

function ensureDbDir(dbPath) {
  if (!dbPath || dbPath === ":memory:") {
    return;
  }
  const dir = dirname(dbPath);
  if (!dir || dir === ".") {
    return;
  }
  mkdirSync(dir, { recursive: true });
}

function initDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id TEXT PRIMARY KEY,
      person_name_b64 TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(person_id) REFERENCES people(id)
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_shifts_start_ts ON shifts(start_ts)");
}

function requireAuth(req, res, token) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    sendJson(res, 401, { error: "unauthorized" });
    return false;
  }
  const provided = header.slice("Bearer ".length);
  if (provided !== token) {
    sendJson(res, 401, { error: "unauthorized" });
    return false;
  }
  return true;
}

function parseTimestamp(value) {
  if (typeof value !== "string") {
    throw new Error("timestamp must be a string");
  }
  const tzPattern = /(Z|[+-]\d{2}:\d{2})$/;
  if (!tzPattern.test(value)) {
    throw new Error("timestamp must include timezone");
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("invalid timestamp");
  }
  return date;
}

function listPeople(db) {
  const stmt = db.prepare(
    "SELECT id, person_name_b64, created_at, updated_at FROM people ORDER BY created_at"
  );
  return stmt.all();
}

function listShifts(db) {
  const stmt = db.prepare(`
    SELECT s.id, s.person_id, p.person_name_b64, s.start_at, s.end_at, s.created_at, s.updated_at
    FROM shifts s
    JOIN people p ON p.id = s.person_id
    WHERE s.start_ts >= ?
    ORDER BY s.start_ts ASC
  `);
  return stmt.all(Date.now());
}

async function handleRequest(req, res, state) {
  const url = new URL(req.url || "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    });
    res.end();
    return;
  }

  if (!requireAuth(req, res, state.token)) {
    return;
  }

  if (req.method === "GET" && parts.length === 1 && parts[0] === "people") {
    sendJson(res, 200, { people: listPeople(state.db) });
    return;
  }

  if (req.method === "POST" && parts.length === 1 && parts[0] === "people") {
    try {
      const payload = (await readJsonBody(req)) || {};
      const name = payload.person_name;
      if (!name) {
        sendJson(res, 400, { error: "person_name is required" });
        return;
      }
      const id = randomUUID();
      const now = utcNow();
      const person = {
        id,
        person_name_b64: encodeName(name),
        created_at: now,
        updated_at: now,
      };
      const stmt = state.db.prepare(
        "INSERT INTO people (id, person_name_b64, created_at, updated_at) VALUES (?, ?, ?, ?)"
      );
      stmt.run(person.id, person.person_name_b64, person.created_at, person.updated_at);
      sendJson(res, 201, person);
    } catch (err) {
      sendJson(res, 400, { error: err.message || "invalid request" });
    }
    return;
  }

  if (req.method === "PUT" && parts.length === 2 && parts[0] === "people") {
    try {
      const payload = (await readJsonBody(req)) || {};
      const name = payload.person_name;
      if (!name) {
        sendJson(res, 400, { error: "person_name is required" });
        return;
      }
      const existing = state.db
        .prepare("SELECT id, created_at FROM people WHERE id = ?")
        .get(parts[1]);
      if (!existing) {
        sendJson(res, 404, { error: "person not found" });
        return;
      }
      const updatedAt = utcNow();
      const nameB64 = encodeName(name);
      state.db
        .prepare("UPDATE people SET person_name_b64 = ?, updated_at = ? WHERE id = ?")
        .run(nameB64, updatedAt, parts[1]);
      sendJson(res, 200, {
        id: parts[1],
        person_name_b64: nameB64,
        created_at: existing.created_at,
        updated_at: updatedAt,
      });
    } catch (err) {
      sendJson(res, 400, { error: err.message || "invalid request" });
    }
    return;
  }

  if (req.method === "DELETE" && parts.length === 2 && parts[0] === "people") {
    const person = state.db.prepare("SELECT id FROM people WHERE id = ?").get(parts[1]);
    if (!person) {
      sendJson(res, 404, { error: "person not found" });
      return;
    }
    const ref = state.db
      .prepare("SELECT COUNT(1) AS count FROM shifts WHERE person_id = ?")
      .get(parts[1]);
    if (ref.count > 0) {
      sendJson(res, 409, { error: "person has shifts" });
      return;
    }
    state.db.prepare("DELETE FROM people WHERE id = ?").run(parts[1]);
    sendEmpty(res, 204);
    return;
  }

  if (req.method === "GET" && parts.length === 1 && parts[0] === "shifts") {
    sendJson(res, 200, { shifts: listShifts(state.db) });
    return;
  }

  if (req.method === "POST" && parts.length === 1 && parts[0] === "shifts") {
    try {
      const payload = (await readJsonBody(req)) || {};
      const { person_id, start_at, end_at } = payload;
      if (!person_id || !start_at || !end_at) {
        sendJson(res, 400, { error: "person_id, start_at, end_at are required" });
        return;
      }
      const person = state.db
        .prepare("SELECT person_name_b64 FROM people WHERE id = ?")
        .get(person_id);
      if (!person) {
        sendJson(res, 400, { error: "person_id not found" });
        return;
      }
      const startDate = parseTimestamp(start_at);
      const endDate = parseTimestamp(end_at);
      if (endDate <= startDate) {
        sendJson(res, 400, { error: "end_at must be after start_at" });
        return;
      }
      const now = utcNow();
      const shiftId = randomUUID();
      state.db
        .prepare(
          "INSERT INTO shifts (id, person_id, start_at, end_at, start_ts, end_ts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          shiftId,
          person_id,
          startDate.toISOString(),
          endDate.toISOString(),
          startDate.getTime(),
          endDate.getTime(),
          now,
          now
        );
      sendJson(res, 201, {
        id: shiftId,
        person_id,
        person_name_b64: person.person_name_b64,
        start_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        created_at: now,
        updated_at: now,
      });
    } catch (err) {
      sendJson(res, 400, { error: err.message || "invalid request" });
    }
    return;
  }

  if (req.method === "PUT" && parts.length === 2 && parts[0] === "shifts") {
    try {
      const payload = (await readJsonBody(req)) || {};
      const { person_id, start_at, end_at } = payload;
      if (!person_id || !start_at || !end_at) {
        sendJson(res, 400, { error: "person_id, start_at, end_at are required" });
        return;
      }
      const shift = state.db.prepare("SELECT id, created_at FROM shifts WHERE id = ?").get(parts[1]);
      if (!shift) {
        sendJson(res, 404, { error: "shift not found" });
        return;
      }
      const person = state.db
        .prepare("SELECT person_name_b64 FROM people WHERE id = ?")
        .get(person_id);
      if (!person) {
        sendJson(res, 400, { error: "person_id not found" });
        return;
      }
      const startDate = parseTimestamp(start_at);
      const endDate = parseTimestamp(end_at);
      if (endDate <= startDate) {
        sendJson(res, 400, { error: "end_at must be after start_at" });
        return;
      }
      const updatedAt = utcNow();
      state.db
        .prepare(
          "UPDATE shifts SET person_id = ?, start_at = ?, end_at = ?, start_ts = ?, end_ts = ?, updated_at = ? WHERE id = ?"
        )
        .run(
          person_id,
          startDate.toISOString(),
          endDate.toISOString(),
          startDate.getTime(),
          endDate.getTime(),
          updatedAt,
          parts[1]
        );
      sendJson(res, 200, {
        id: parts[1],
        person_id,
        person_name_b64: person.person_name_b64,
        start_at: startDate.toISOString(),
        end_at: endDate.toISOString(),
        created_at: shift.created_at,
        updated_at: updatedAt,
      });
    } catch (err) {
      sendJson(res, 400, { error: err.message || "invalid request" });
    }
    return;
  }

  if (req.method === "DELETE" && parts.length === 2 && parts[0] === "shifts") {
    const shift = state.db.prepare("SELECT id FROM shifts WHERE id = ?").get(parts[1]);
    if (!shift) {
      sendJson(res, 404, { error: "shift not found" });
      return;
    }
    state.db.prepare("DELETE FROM shifts WHERE id = ?").run(parts[1]);
    sendEmpty(res, 204);
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

export function createServer({ host, port, token, dbPath } = {}) {
  const resolved = {
    host: host || DEFAULTS.host,
    port: port ?? DEFAULTS.port,
    token: token || DEFAULTS.token,
    dbPath: dbPath || DEFAULTS.dbPath,
  };
  ensureDbDir(resolved.dbPath);
  const db = new Database(resolved.dbPath);
  initDb(db);

  const state = {
    db,
    token: resolved.token,
  };
  const server = http.createServer((req, res) => {
    void handleRequest(req, res, state);
  });
  server.on("close", () => {
    db.close();
  });
  return { server, state, config: resolved };
}

export function startServer({ host, port, token, dbPath } = {}) {
  const { server, config } = createServer({ host, port, token, dbPath });
  server.listen(config.port, config.host, () => {
    console.log(`listening on http://${config.host}:${config.port}`);
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = startServer({
    host: process.env.SCHED_HOST,
    port: process.env.SCHED_PORT ? Number(process.env.SCHED_PORT) : undefined,
    token: process.env.SCHED_TOKEN,
    dbPath: process.env.SCHED_DB_PATH,
  });
  const shutdown = () => server.close();
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
