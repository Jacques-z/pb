<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

type Shift = {
  id: string;
  person_id: string;
  person_name_b64: string;
  start_at: string;
  end_at: string;
  created_at: string;
  updated_at: string;
};

type Config = {
  serverUrl: string;
  username: string;
  token: string;
  refreshMinutes: number;
};

const DEFAULTS: Config = {
  serverUrl: "http://127.0.0.1:8787",
  username: "",
  token: "",
  refreshMinutes: 1,
};

const CLIENT_HASH_ITERATIONS = 100_000;
const CLIENT_HASH_BYTES = 32;

const config = reactive<Config>({ ...DEFAULTS });
const loginForm = reactive({
  username: "",
  password: "",
});
const shifts = ref<Shift[]>([]);
const status = ref("未登录");
const lastUpdated = ref("--");
const notificationReady = ref(false);
const refreshError = ref<string | null>(null);
const loginBusy = ref(false);

const reminderLeadMs = 15 * 60 * 1000;
const reminderTimers = new Map<string, number>();
const reminderSchedule = new Map<string, number>();
let refreshTimer: number | null = null;

const upcomingCount = computed(() => shifts.value.length);
const loggedIn = computed(() => Boolean(config.token));

function loadConfig() {
  const raw = localStorage.getItem("shiftdesk.config");
  if (!raw) {
    Object.assign(config, DEFAULTS);
    return;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Config>;
    config.serverUrl = parsed.serverUrl || DEFAULTS.serverUrl;
    config.username = parsed.username || DEFAULTS.username;
    config.token = parsed.token || DEFAULTS.token;
    config.refreshMinutes = parsed.refreshMinutes || DEFAULTS.refreshMinutes;
    loginForm.username = config.username;
  } catch {
    Object.assign(config, DEFAULTS);
  }
}

function persistConfig() {
  const minutes = Math.max(1, Math.floor(config.refreshMinutes || DEFAULTS.refreshMinutes));
  config.refreshMinutes = minutes;
  localStorage.setItem("shiftdesk.config", JSON.stringify(config));
  scheduleRefresh();
}

function setStatus(next: string, error?: string | null) {
  status.value = next;
  refreshError.value = error ?? null;
}

function decodeName(b64: string) {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "未知姓名";
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

async function hashPassword(username: string, password: string) {
  if (!window.crypto?.subtle) {
    throw new Error("浏览器不支持加密接口");
  }
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derived = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: encoder.encode(username),
      iterations: CLIENT_HASH_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    CLIENT_HASH_BYTES * 8
  );
  return bytesToBase64(new Uint8Array(derived));
}

async function ensureNotifications() {
  const granted = await isPermissionGranted();
  if (granted) {
    notificationReady.value = true;
    return;
  }
  const permission = await requestPermission();
  notificationReady.value = permission === "granted";
}

async function login() {
  if (!config.serverUrl || !loginForm.username || !loginForm.password) {
    setStatus("缺少配置", "请填写服务端地址、用户名与密码");
    return;
  }
  loginBusy.value = true;
  setStatus("登录中...");
  try {
    const passwordClientHash = await hashPassword(loginForm.username, loginForm.password);
    const resp = await fetch(`${config.serverUrl.replace(/\/$/, "")}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: loginForm.username,
        password_client_hash: passwordClientHash,
      }),
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body?.error || `登录失败 (${resp.status})`);
    }
    const payload = await resp.json();
    config.username = loginForm.username;
    config.token = payload.token;
    loginForm.password = "";
    persistConfig();
    scheduleRefresh();
    setStatus("已登录");
    await fetchShifts();
  } catch (err) {
    setStatus("登录失败", err instanceof Error ? err.message : "未知错误");
  } finally {
    loginBusy.value = false;
  }
}

async function logout() {
  if (config.token && config.serverUrl) {
    await fetch(`${config.serverUrl.replace(/\/$/, "")}/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    }).catch(() => undefined);
  }
  config.token = "";
  persistConfig();
  shifts.value = [];
  setStatus("未登录");
}

async function fetchShifts() {
  if (!config.serverUrl || !config.token) {
    setStatus("未登录", "请先登录以同步班次");
    return;
  }
  setStatus("同步中...");
  try {
    const resp = await fetch(`${config.serverUrl.replace(/\/$/, "")}/shifts`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    });
    if (resp.status === 401) {
      config.token = "";
      persistConfig();
      setStatus("登录失效", "请重新登录");
      return;
    }
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body?.error || `请求失败 (${resp.status})`);
    }
    const payload = await resp.json();
    shifts.value = payload.shifts || [];
    lastUpdated.value = new Date().toLocaleTimeString();
    setStatus("已登录");
    syncReminders(shifts.value);
  } catch (err) {
    setStatus("连接失败", err instanceof Error ? err.message : "未知错误");
  }
}

function scheduleRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }
  refreshTimer = window.setInterval(() => {
    fetchShifts();
  }, config.refreshMinutes * 60 * 1000);
}

function clearReminder(id: string) {
  const timer = reminderTimers.get(id);
  if (timer) {
    window.clearTimeout(timer);
  }
  reminderTimers.delete(id);
  reminderSchedule.delete(id);
}

function syncReminders(next: Shift[]) {
  const now = Date.now();
  const nextIds = new Set(next.map((shift) => shift.id));
  for (const id of reminderTimers.keys()) {
    if (!nextIds.has(id)) {
      clearReminder(id);
    }
  }

  next.forEach((shift) => {
    const triggerAt = new Date(shift.start_at).getTime() - reminderLeadMs;
    if (Number.isNaN(triggerAt) || triggerAt <= now) {
      clearReminder(shift.id);
      return;
    }
    const previous = reminderSchedule.get(shift.id);
    if (previous === triggerAt) {
      return;
    }
    clearReminder(shift.id);
    const timeout = window.setTimeout(() => {
      notifyShift(shift);
      clearReminder(shift.id);
    }, triggerAt - now);
    reminderTimers.set(shift.id, timeout);
    reminderSchedule.set(shift.id, triggerAt);
  });
}

function notifyShift(shift: Shift) {
  if (!notificationReady.value) {
    return;
  }
  const person = decodeName(shift.person_name_b64);
  const startTime = formatTime(shift.start_at);
  sendNotification({
    title: "班次提醒",
    body: `${person} - ${startTime}`,
  });
}

onMounted(async () => {
  loadConfig();
  await ensureNotifications();
  scheduleRefresh();
  fetchShifts();
});

onBeforeUnmount(() => {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }
  for (const id of reminderTimers.keys()) {
    clearReminder(id);
  }
});
</script>

<template>
  <div class="app-shell min-h-screen">
    <div class="max-w-5xl mx-auto px-6 py-10 space-y-8">
      <header class="space-y-3">
        <div class="flex items-center gap-3">
          <div class="badge badge-outline badge-lg">Shift Desk</div>
          <span class="text-sm text-base-content/60">排班 MVP</span>
        </div>
        <h1 class="text-3xl md:text-4xl font-semibold">即将到来的班次</h1>
        <p class="text-base text-base-content/70 max-w-2xl">
          本地提醒默认提前 15 分钟触发，适合持续运行的排班桌面客户端。
        </p>
      </header>

      <section class="grid lg:grid-cols-[1.1fr_1.5fr] gap-6">
        <div class="card bg-base-100 shadow-xl border border-base-200">
          <div class="card-body space-y-4">
            <div class="flex items-center justify-between">
              <h2 class="card-title">连接配置</h2>
              <span
                class="badge"
                :class="loggedIn ? 'badge-success' : 'badge-ghost'"
              >
                {{ status }}
              </span>
            </div>
            <div class="space-y-3">
              <label class="form-control">
                <div class="label">
                  <span class="label-text">服务端地址</span>
                </div>
                <input
                  v-model="config.serverUrl"
                  class="input input-bordered"
                  type="text"
                  placeholder="http://127.0.0.1:8787"
                />
              </label>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">用户名</span>
                </div>
                <input
                  v-model="loginForm.username"
                  class="input input-bordered"
                  type="text"
                  placeholder="admin"
                />
              </label>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">密码</span>
                </div>
                <input
                  v-model="loginForm.password"
                  class="input input-bordered"
                  type="password"
                  placeholder="••••••"
                />
              </label>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">刷新间隔（分钟）</span>
                </div>
                <input
                  v-model.number="config.refreshMinutes"
                  class="input input-bordered"
                  type="number"
                  min="1"
                  max="60"
                />
              </label>
              <div class="text-xs text-base-content/60">
                当前刷新间隔：{{ config.refreshMinutes }} 分钟
              </div>
              <div v-if="refreshError" class="text-xs text-error">
                {{ refreshError }}
              </div>
            </div>
            <div class="flex flex-wrap gap-2">
              <button class="btn btn-primary" :disabled="loginBusy" @click="login">
                {{ loginBusy ? "登录中..." : "登录" }}
              </button>
              <button class="btn btn-ghost" @click="logout" :disabled="!loggedIn">
                退出登录
              </button>
              <button class="btn btn-ghost" @click="persistConfig">
                保存设置
              </button>
              <button class="btn btn-ghost" @click="fetchShifts" :disabled="!loggedIn">
                立即刷新
              </button>
            </div>
            <div class="text-xs text-base-content/60">
              通知权限：{{ notificationReady ? "已授权" : "未授权" }}
            </div>
          </div>
        </div>

        <div class="card bg-base-100 shadow-xl border border-base-200">
          <div class="card-body space-y-4">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="card-title">即将到来的班次</h2>
                <p class="text-xs text-base-content/60">
                  已加载 {{ upcomingCount }} 条 · 最后更新 {{ lastUpdated }}
                </p>
              </div>
            </div>

            <div v-if="shifts.length === 0" class="p-6 rounded-2xl bg-base-200/70">
              <p class="text-sm text-base-content/70">暂时没有即将到来的班次。</p>
            </div>

            <div class="space-y-3">
              <div
                v-for="shift in shifts"
                :key="shift.id"
                class="rounded-2xl border border-base-200 bg-base-100 p-4 space-y-2"
              >
                <div class="flex items-center justify-between">
                  <div class="text-lg font-semibold">
                    {{ decodeName(shift.person_name_b64) }}
                  </div>
                  <span class="badge badge-outline">{{ shift.person_id.slice(0, 6) }}</span>
                </div>
                <div class="text-sm text-base-content/70">
                  {{ formatTime(shift.start_at) }} → {{ formatTime(shift.end_at) }}
                </div>
                <div class="text-xs text-base-content/50">
                  班次 ID: {{ shift.id }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer class="text-xs text-base-content/60">
        提醒默认提前 15 分钟触发，应用关闭主窗口后仍会在后台运行，直到显式退出。
      </footer>
    </div>
  </div>
</template>
