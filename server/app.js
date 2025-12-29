#!/usr/bin/env node
import http from "node:http";
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const DEFAULTS = {
  host: "127.0.0.1",
  port: 8787,
  dbPath: "server/data.db",
};

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SERVER_HASH_ITERATIONS = 150_000;
const SERVER_HASH_BYTES = 32;

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
  db.pragma("foreign_keys = ON");
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      person_name_b64 TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_credentials (
      user_id TEXT PRIMARY KEY,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      expires_ts INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sessions_expires_ts ON sessions(expires_ts)");
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      occurred_at TEXT NOT NULL,
      actor_user_id TEXT,
      actor_username TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      request_method TEXT NOT NULL,
      request_path TEXT NOT NULL,
      status_code INTEGER NOT NULL
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_audit_logs_occurred_at ON audit_logs(occurred_at)");
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
    "SELECT id, person_name_b64, created_at, updated_at FROM users ORDER BY created_at"
  );
  return stmt.all();
}

function listUsers(db) {
  const stmt = db.prepare(
    "SELECT id, username, person_name_b64, is_admin, created_at, updated_at FROM users ORDER BY created_at"
  );
  return stmt.all().map((row) => ({
    ...row,
    is_admin: Boolean(row.is_admin),
  }));
}

function listShifts(db, range) {
  const conditions = [];
  const params = [];
  if (range?.startTs != null) {
    conditions.push("s.start_ts >= ?");
    params.push(range.startTs);
  }
  if (range?.endTs != null) {
    conditions.push("s.start_ts <= ?");
    params.push(range.endTs);
  }
  if (!range || (range.startTs == null && range.endTs == null)) {
    conditions.push("s.start_ts >= ?");
    params.push(Date.now());
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const stmt = db.prepare(`
    SELECT s.id, s.person_id, p.person_name_b64, s.start_at, s.end_at, s.created_at, s.updated_at
    FROM shifts s
    JOIN people p ON p.id = s.person_id
    ${whereClause}
    ORDER BY s.start_ts ASC
  `);
  return stmt.all(...params);
}

function listAuditLogs(db, limit) {
  const stmt = db.prepare(`
    SELECT id, occurred_at, actor_user_id, actor_username, action, resource_type, resource_id, request_method, request_path, status_code
    FROM audit_logs
    ORDER BY occurred_at DESC
    LIMIT ?
  `);
  return stmt.all(limit);
}

function parseLimit(value, defaultLimit, maxLimit) {
  if (value == null) {
    return { value: defaultLimit, error: null };
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: null, error: "limit must be a positive integer" };
  }
  return { value: Math.min(parsed, maxLimit), error: null };
}

function hashServerPassword(passwordClientHash, saltB64) {
  const salt = Buffer.from(saltB64, "base64");
  return pbkdf2Sync(
    passwordClientHash,
    salt,
    SERVER_HASH_ITERATIONS,
    SERVER_HASH_BYTES,
    "sha256"
  ).toString("base64");
}

function verifyPassword(passwordClientHash, saltB64, hashB64) {
  const computed = hashServerPassword(passwordClientHash, saltB64);
  const computedBuf = Buffer.from(computed, "base64");
  const storedBuf = Buffer.from(hashB64, "base64");
  if (computedBuf.length !== storedBuf.length) {
    return false;
  }
  return timingSafeEqual(computedBuf, storedBuf);
}

function createPasswordRecord(passwordClientHash) {
  const salt = randomBytes(16).toString("base64");
  const hash = hashServerPassword(passwordClientHash, salt);
  const now = utcNow();
  return {
    password_salt: salt,
    password_hash: hash,
    created_at: now,
    updated_at: now,
  };
}

function createSession(db, userId) {
  const token = randomBytes(24).toString("base64url");
  const now = Date.now();
  const expires = now + SESSION_TTL_MS;
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(expires).toISOString();
  db.prepare(
    "INSERT INTO sessions (token, user_id, created_at, expires_at, expires_ts) VALUES (?, ?, ?, ?, ?)"
  ).run(token, userId, createdAt, expiresAt, expires);
  return { token, expires_at: expiresAt };
}

function invalidateSessions(db, userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

function deleteSession(db, token) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

function requireSession(req, res, db) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  const token = header.slice("Bearer ".length);
  const session = db
    .prepare("SELECT token, user_id, expires_ts FROM sessions WHERE token = ?")
    .get(token);
  if (!session) {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  if (session.expires_ts <= Date.now()) {
    deleteSession(db, token);
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  const user = db
    .prepare("SELECT id, username, person_name_b64, is_admin FROM users WHERE id = ?")
    .get(session.user_id);
  if (!user) {
    sendJson(res, 401, { error: "unauthorized" });
    return null;
  }
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      person_name_b64: user.person_name_b64,
      is_admin: Boolean(user.is_admin),
    },
  };
}

function requireAdmin(user, res) {
  if (!user?.is_admin) {
    sendJson(res, 403, { error: "forbidden" });
    return false;
  }
  return true;
}

function recordAuditLog(db, entry) {
  const now = utcNow();
  db.prepare(
    "INSERT INTO audit_logs (id, occurred_at, actor_user_id, actor_username, action, resource_type, resource_id, request_method, request_path, status_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    randomUUID(),
    now,
    entry.actor_user_id || null,
    entry.actor_username || null,
    entry.action,
    entry.resource_type,
    entry.resource_id || null,
    entry.request_method,
    entry.request_path,
    entry.status_code
  );
}

function countUsers(db) {
  return db.prepare("SELECT COUNT(1) AS count FROM users").get().count;
}

function upsertPerson(db, userId, nameB64, createdAt, updatedAt) {
  const existing = db.prepare("SELECT id FROM people WHERE id = ?").get(userId);
  if (existing) {
    db.prepare("UPDATE people SET person_name_b64 = ?, updated_at = ? WHERE id = ?").run(
      nameB64,
      updatedAt,
      userId
    );
    return;
  }
  db.prepare(
    "INSERT INTO people (id, person_name_b64, created_at, updated_at) VALUES (?, ?, ?, ?)"
  ).run(userId, nameB64, createdAt, updatedAt);
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

  if (req.method === "POST" && parts[0] === "auth" && parts[1] === "bootstrap") {
    if (countUsers(state.db) > 0) {
      sendJson(res, 409, { error: "already initialized" });
      return;
    }
    try {
      const payload = (await readJsonBody(req)) || {};
      const username = payload.username;
      const passwordClientHash = payload.password_client_hash;
      const personName = payload.person_name;
      if (!username || !passwordClientHash || !personName) {
        sendJson(res, 400, { error: "username, password_client_hash, person_name are required" });
        return;
      }
      const userId = randomUUID();
      const now = utcNow();
      const nameB64 = encodeName(personName);
      state.db
        .prepare(
          "INSERT INTO users (id, username, person_name_b64, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(userId, username, nameB64, 1, now, now);
      upsertPerson(state.db, userId, nameB64, now, now);
      const creds = createPasswordRecord(passwordClientHash);
      state.db
        .prepare(
          "INSERT INTO user_credentials (user_id, password_salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
        )
        .run(userId, creds.password_salt, creds.password_hash, creds.created_at, creds.updated_at);
      const session = createSession(state.db, userId);
      recordAuditLog(state.db, {
        actor_user_id: userId,
        actor_username: username,
        action: "auth.bootstrap",
        resource_type: "user",
        resource_id: userId,
        request_method: req.method,
        request_path: url.pathname,
        status_code: 201,
      });
      sendJson(res, 201, {
        token: session.token,
        expires_at: session.expires_at,
        user: {
          id: userId,
          username,
          person_name_b64: nameB64,
          is_admin: true,
          created_at: now,
          updated_at: now,
        },
      });
    } catch (err) {
      sendJson(res, 400, { error: err.message || "invalid request" });
    }
    return;
  }

  if (req.method === "POST" && parts[0] === "auth" && parts[1] === "login") {
    try {
      const payload = (await readJsonBody(req)) || {};
      const username = payload.username;
      const passwordClientHash = payload.password_client_hash;
      if (!username || !passwordClientHash) {
        sendJson(res, 400, { error: "username and password_client_hash are required" });
        return;
      }
      const user = state.db
        .prepare("SELECT id, username, person_name_b64, is_admin FROM users WHERE username = ?")
        .get(username);
      if (!user) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const creds = state.db
        .prepare("SELECT password_salt, password_hash FROM user_credentials WHERE user_id = ?")
        .get(user.id);
      if (!creds || !verifyPassword(passwordClientHash, creds.password_salt, creds.password_hash)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const session = createSession(state.db, user.id);
      recordAuditLog(state.db, {
        actor_user_id: user.id,
        actor_username: user.username,
        action: "auth.login",
        resource_type: "session",
        resource_id: null,
        request_method: req.method,
        request_path: url.pathname,
        status_code: 200,
      });
      sendJson(res, 200, {
        token: session.token,
        expires_at: session.expires_at,
        user: {
          id: user.id,
          username: user.username,
          person_name_b64: user.person_name_b64,
          is_admin: Boolean(user.is_admin),
        },
      });
    } catch (err) {
      sendJson(res, 400, { error: err.message || "invalid request" });
    }
    return;
  }

  if (req.method === "POST" && parts[0] === "auth" && parts[1] === "logout") {
    const session = requireSession(req, res, state.db);
    if (!session) return;
    deleteSession(state.db, session.token);
    recordAuditLog(state.db, {
      actor_user_id: session.user.id,
      actor_username: session.user.username,
      action: "auth.logout",
      resource_type: "session",
      resource_id: null,
      request_method: req.method,
      request_path: url.pathname,
      status_code: 204,
    });
    sendEmpty(res, 204);
    return;
  }

  if (req.method === "POST" && parts[0] === "auth" && parts[1] === "change-password") {
    const session = requireSession(req, res, state.db);
    if (!session) return;
    try {
      const payload = (await readJsonBody(req)) || {};
      const currentHash = payload.current_password_client_hash;
      const nextHash = payload.new_password_client_hash;
      if (!currentHash || !nextHash) {
        sendJson(res, 400, { error: "current_password_client_hash and new_password_client_hash are required" });
        return;
      }
      const creds = state.db
        .prepare("SELECT password_salt, password_hash FROM user_credentials WHERE user_id = ?")
        .get(session.user.id);
      if (!creds || !verifyPassword(currentHash, creds.password_salt, creds.password_hash)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      const updatedAt = utcNow();
      const next = createPasswordRecord(nextHash);
      state.db
        .prepare(
          "UPDATE user_credentials SET password_salt = ?, password_hash = ?, updated_at = ? WHERE user_id = ?"
        )
        .run(next.password_salt, next.password_hash, updatedAt, session.user.id);
      invalidateSessions(state.db, session.user.id);
      recordAuditLog(state.db, {
        actor_user_id: session.user.id,
        actor_username: session.user.username,
        action: "auth.change_password",
        resource_type: "user",
        resource_id: session.user.id,
        request_method: req.method,
        request_path: url.pathname,
        status_code: 204,
      });
      sendEmpty(res, 204);
    } catch (err) {
      sendJson(res, 400, { error: err.message || "invalid request" });
    }
    return;
  }

  const session = requireSession(req, res, state.db);
  if (!session) {
    return;
  }

  if (req.method === "GET" && parts.length === 1 && parts[0] === "people") {
    sendJson(res, 200, { people: listPeople(state.db) });
    return;
  }

  if (parts.length >= 1 && parts[0] === "users") {
    if (!requireAdmin(session.user, res)) {
      return;
    }

    if (req.method === "GET" && parts.length === 1) {
      sendJson(res, 200, { users: listUsers(state.db) });
      return;
    }

    if (req.method === "POST" && parts.length === 1) {
      try {
        const payload = (await readJsonBody(req)) || {};
        const username = payload.username;
        const passwordClientHash = payload.password_client_hash;
        const personName = payload.person_name;
        const isAdmin = Boolean(payload.is_admin);
        if (!username || !passwordClientHash || !personName) {
          sendJson(res, 400, {
            error: "username, password_client_hash, person_name are required",
          });
          return;
        }
        const existing = state.db
          .prepare("SELECT id FROM users WHERE username = ?")
          .get(username);
        if (existing) {
          sendJson(res, 409, { error: "username already exists" });
          return;
        }
        const userId = randomUUID();
        const now = utcNow();
        const nameB64 = encodeName(personName);
        state.db
          .prepare(
            "INSERT INTO users (id, username, person_name_b64, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .run(userId, username, nameB64, isAdmin ? 1 : 0, now, now);
        upsertPerson(state.db, userId, nameB64, now, now);
        const creds = createPasswordRecord(passwordClientHash);
        state.db
          .prepare(
            "INSERT INTO user_credentials (user_id, password_salt, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
          )
          .run(userId, creds.password_salt, creds.password_hash, creds.created_at, creds.updated_at);
        recordAuditLog(state.db, {
          actor_user_id: session.user.id,
          actor_username: session.user.username,
          action: "users.create",
          resource_type: "user",
          resource_id: userId,
          request_method: req.method,
          request_path: url.pathname,
          status_code: 201,
        });
        sendJson(res, 201, {
          id: userId,
          username,
          person_name_b64: nameB64,
          is_admin: isAdmin,
          created_at: now,
          updated_at: now,
        });
      } catch (err) {
        sendJson(res, 400, { error: err.message || "invalid request" });
      }
      return;
    }

    if (req.method === "PUT" && parts.length === 2) {
      try {
        const payload = (await readJsonBody(req)) || {};
        if (Object.prototype.hasOwnProperty.call(payload, "username")) {
          sendJson(res, 409, { error: "username is immutable" });
          return;
        }
        const personName = payload.person_name;
        const hasPersonName = typeof personName === "string" && personName.length > 0;
        const hasIsAdmin = Object.prototype.hasOwnProperty.call(payload, "is_admin");
        if (!hasPersonName && !hasIsAdmin) {
          sendJson(res, 400, { error: "person_name or is_admin is required" });
          return;
        }
        const existing = state.db
          .prepare("SELECT id, username, person_name_b64, is_admin, created_at FROM users WHERE id = ?")
          .get(parts[1]);
        if (!existing) {
          sendJson(res, 404, { error: "user not found" });
          return;
        }
        const updatedAt = utcNow();
        const nextNameB64 = hasPersonName ? encodeName(personName) : existing.person_name_b64;
        const nextIsAdmin = hasIsAdmin ? Boolean(payload.is_admin) : Boolean(existing.is_admin);
        state.db
          .prepare(
            "UPDATE users SET person_name_b64 = ?, is_admin = ?, updated_at = ? WHERE id = ?"
          )
          .run(nextNameB64, nextIsAdmin ? 1 : 0, updatedAt, parts[1]);
        if (hasPersonName) {
          upsertPerson(state.db, parts[1], nextNameB64, existing.created_at, updatedAt);
        }
        recordAuditLog(state.db, {
          actor_user_id: session.user.id,
          actor_username: session.user.username,
          action: "users.update",
          resource_type: "user",
          resource_id: parts[1],
          request_method: req.method,
          request_path: url.pathname,
          status_code: 200,
        });
        sendJson(res, 200, {
          id: parts[1],
          username: existing.username,
          person_name_b64: nextNameB64,
          is_admin: nextIsAdmin,
          created_at: existing.created_at,
          updated_at: updatedAt,
        });
      } catch (err) {
        sendJson(res, 400, { error: err.message || "invalid request" });
      }
      return;
    }

    if (req.method === "DELETE" && parts.length === 2) {
      const user = state.db.prepare("SELECT id, username FROM users WHERE id = ?").get(parts[1]);
      if (!user) {
        sendJson(res, 404, { error: "user not found" });
        return;
      }
      const ref = state.db
        .prepare("SELECT COUNT(1) AS count FROM shifts WHERE person_id = ?")
        .get(parts[1]);
      if (ref.count > 0) {
        sendJson(res, 409, { error: "user has shifts" });
        return;
      }
      state.db.prepare("DELETE FROM users WHERE id = ?").run(parts[1]);
      state.db.prepare("DELETE FROM people WHERE id = ?").run(parts[1]);
      recordAuditLog(state.db, {
        actor_user_id: session.user.id,
        actor_username: session.user.username,
        action: "users.delete",
        resource_type: "user",
        resource_id: parts[1],
        request_method: req.method,
        request_path: url.pathname,
        status_code: 204,
      });
      sendEmpty(res, 204);
      return;
    }

    if (req.method === "POST" && parts.length === 3 && parts[2] === "reset-password") {
      try {
        const payload = (await readJsonBody(req)) || {};
        const passwordClientHash = payload.password_client_hash;
        if (!passwordClientHash) {
          sendJson(res, 400, { error: "password_client_hash is required" });
          return;
        }
        const user = state.db.prepare("SELECT id FROM users WHERE id = ?").get(parts[1]);
        if (!user) {
          sendJson(res, 404, { error: "user not found" });
          return;
        }
        const updatedAt = utcNow();
        const next = createPasswordRecord(passwordClientHash);
        state.db
          .prepare(
            "UPDATE user_credentials SET password_salt = ?, password_hash = ?, updated_at = ? WHERE user_id = ?"
          )
          .run(next.password_salt, next.password_hash, updatedAt, parts[1]);
        invalidateSessions(state.db, parts[1]);
        recordAuditLog(state.db, {
          actor_user_id: session.user.id,
          actor_username: session.user.username,
          action: "users.reset_password",
          resource_type: "user",
          resource_id: parts[1],
          request_method: req.method,
          request_path: url.pathname,
          status_code: 204,
        });
        sendEmpty(res, 204);
      } catch (err) {
        sendJson(res, 400, { error: err.message || "invalid request" });
      }
      return;
    }
  }

  if (req.method === "GET" && parts.length === 1 && parts[0] === "audit-logs") {
    if (!requireAdmin(session.user, res)) {
      return;
    }
    const { value: limit, error } = parseLimit(
      url.searchParams.get("limit"),
      100,
      500
    );
    if (error) {
      sendJson(res, 400, { error });
      return;
    }
    sendJson(res, 200, { logs: listAuditLogs(state.db, limit) });
    return;
  }

  if (req.method === "GET" && parts.length === 1 && parts[0] === "shifts") {
    const startParam = url.searchParams.get("start_at");
    const endParam = url.searchParams.get("end_at");
    if (startParam || endParam) {
      try {
        const startTs = startParam ? parseTimestamp(startParam).getTime() : null;
        const endTs = endParam ? parseTimestamp(endParam).getTime() : null;
        if (startTs != null && endTs != null && endTs < startTs) {
          sendJson(res, 400, { error: "end_at must be after start_at" });
          return;
        }
        sendJson(res, 200, { shifts: listShifts(state.db, { startTs, endTs }) });
      } catch (err) {
        sendJson(res, 400, { error: err.message || "invalid request" });
      }
      return;
    }
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
        .prepare("SELECT id, person_name_b64 FROM users WHERE id = ?")
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
      recordAuditLog(state.db, {
        actor_user_id: session.user.id,
        actor_username: session.user.username,
        action: "shifts.create",
        resource_type: "shift",
        resource_id: shiftId,
        request_method: req.method,
        request_path: url.pathname,
        status_code: 201,
      });
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
        .prepare("SELECT id, person_name_b64 FROM users WHERE id = ?")
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
      recordAuditLog(state.db, {
        actor_user_id: session.user.id,
        actor_username: session.user.username,
        action: "shifts.update",
        resource_type: "shift",
        resource_id: parts[1],
        request_method: req.method,
        request_path: url.pathname,
        status_code: 200,
      });
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
    recordAuditLog(state.db, {
      actor_user_id: session.user.id,
      actor_username: session.user.username,
      action: "shifts.delete",
      resource_type: "shift",
      resource_id: parts[1],
      request_method: req.method,
      request_path: url.pathname,
      status_code: 204,
    });
    sendEmpty(res, 204);
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

export function createServer({ host, port, dbPath } = {}) {
  const resolved = {
    host: host || DEFAULTS.host,
    port: port ?? DEFAULTS.port,
    dbPath: dbPath || DEFAULTS.dbPath,
  };
  ensureDbDir(resolved.dbPath);
  const db = new Database(resolved.dbPath);
  initDb(db);
  const server = http.createServer((req, res) => {
    handleRequest(req, res, { db }).catch((err) => {
      sendJson(res, 500, { error: err?.message || "internal error" });
    });
  });
  return {
    server,
    config: resolved,
    db,
  };
}

export function startServer({ host, port, dbPath } = {}) {
  const { server, config, db } = createServer({ host, port, dbPath });
  server.listen(config.port, config.host, () => {
    console.log(`listening on http://${config.host}:${config.port}`);
  });
  return { server, config, db };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer({
    host: process.env.SCHED_HOST,
    port: process.env.SCHED_PORT ? Number(process.env.SCHED_PORT) : undefined,
    dbPath: process.env.SCHED_DB_PATH,
  });
}
