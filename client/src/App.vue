<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
} from "vue";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type {
  AuditLog,
  Config,
  NavItem,
  Person,
  SectionId,
  Shift,
  User,
} from "./lib/types";
import {
  decodeName,
  formatTime,
  parseLocalDateTime,
  toLocalDateTimeParts,
} from "./lib/format";

const OverviewSection = defineAsyncComponent(
  () => import("./components/OverviewSection.vue")
);
const ShiftsSection = defineAsyncComponent(
  () => import("./components/ShiftsSection.vue")
);
const PeopleSection = defineAsyncComponent(
  () => import("./components/PeopleSection.vue")
);
const UsersSection = defineAsyncComponent(
  () => import("./components/UsersSection.vue")
);
const AuditSection = defineAsyncComponent(
  () => import("./components/AuditSection.vue")
);
const AccountSection = defineAsyncComponent(
  () => import("./components/AccountSection.vue")
);

const DEFAULTS: Config = {
  serverUrl: "http://127.0.0.1:8787",
  username: "",
  token: "",
  refreshMinutes: 1,
  userId: "",
  isAdmin: false,
};

const CLIENT_HASH_ITERATIONS = 100_000;
const CLIENT_HASH_BYTES = 32;

const config = reactive<Config>({ ...DEFAULTS });
const loginForm = reactive({
  username: "",
  password: "",
});

const shifts = ref<Shift[]>([]);
const people = ref<Person[]>([]);
const users = ref<User[]>([]);
const auditLogs = ref<AuditLog[]>([]);

const status = ref("未登录");
const lastUpdated = ref("--");
const notificationReady = ref(false);
const refreshError = ref<string | null>(null);
const loginBusy = ref(false);

const activeSection = ref<SectionId>("overview");

const shiftForm = reactive({
  id: "",
  person_id: "",
  start_date: "",
  start_time: "",
  end_date: "",
  end_time: "",
});
const shiftError = ref<string | null>(null);
const shiftMessage = ref<string | null>(null);
const shiftBusy = ref(false);

const peopleError = ref<string | null>(null);
const peopleMessage = ref<string | null>(null);
const peopleBusy = ref(false);

const userCreateForm = reactive({
  username: "",
  person_name: "",
  password: "",
  is_admin: false,
});
const userEditForm = reactive({
  id: "",
  username: "",
  person_name: "",
  is_admin: false,
});
const userResetForm = reactive({
  user_id: "",
  new_password: "",
});
const userError = ref<string | null>(null);
const userMessage = ref<string | null>(null);
const userBusy = ref(false);

const auditLimit = ref(100);
const auditError = ref<string | null>(null);
const auditMessage = ref<string | null>(null);
const auditBusy = ref(false);

const accountForm = reactive({
  current_password: "",
  new_password: "",
});
const accountError = ref<string | null>(null);
const accountMessage = ref<string | null>(null);
const accountBusy = ref(false);

const reminderLeadMs = 15 * 60 * 1000;
const reminderTimers = new Map<string, number>();
const reminderSchedule = new Map<string, number>();
let refreshTimer: number | null = null;

const upcomingCount = computed(() => shifts.value.length);
const loggedIn = computed(() => Boolean(config.token));
const isAdmin = computed(() => Boolean(config.isAdmin));

const navItems: NavItem[] = [
  { id: "overview", label: "概览", auth: false, admin: false },
  { id: "shifts", label: "班次管理", auth: true, admin: false },
  { id: "people", label: "人员目录", auth: true, admin: false },
  { id: "users", label: "用户管理", auth: true, admin: true },
  { id: "audit", label: "审计日志", auth: true, admin: true },
  { id: "account", label: "账号设置", auth: true, admin: false },
];

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
    config.userId = parsed.userId || DEFAULTS.userId;
    config.isAdmin = parsed.isAdmin ?? DEFAULTS.isAdmin;
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

function resetMessages() {
  shiftError.value = null;
  shiftMessage.value = null;
  peopleError.value = null;
  peopleMessage.value = null;
  userError.value = null;
  userMessage.value = null;
  auditError.value = null;
  auditMessage.value = null;
  accountError.value = null;
  accountMessage.value = null;
}

function baseUrl() {
  return config.serverUrl.replace(/\/$/, "");
}

function clearSession(nextStatus = "未登录", message?: string) {
  config.token = "";
  config.userId = "";
  config.isAdmin = false;
  persistConfig();
  shifts.value = [];
  activeSection.value = "overview";
  setStatus(nextStatus, message);
}

async function parseJsonResponse(resp: Response) {
  const text = await resp.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function authFetch(path: string, options: RequestInit = {}) {
  if (!config.serverUrl) {
    throw new Error("缺少服务端地址");
  }
  if (!config.token) {
    throw new Error("未登录");
  }
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  headers.Authorization = `Bearer ${config.token}`;
  const resp = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers,
  });
  if (resp.status === 401) {
    clearSession("登录失效", "请重新登录");
    throw new Error("登录失效");
  }
  return resp;
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
    const resp = await fetch(`${baseUrl()}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: loginForm.username,
        password_client_hash: passwordClientHash,
      }),
    });
    const payload = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(payload?.error || `登录失败 (${resp.status})`);
    }
    config.username = loginForm.username;
    config.token = payload.token;
    config.userId = payload.user?.id || "";
    config.isAdmin = Boolean(payload.user?.is_admin);
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
    await fetch(`${baseUrl()}/auth/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
    }).catch(() => undefined);
  }
  clearSession("未登录");
  resetMessages();
}

async function fetchShifts() {
  if (!config.serverUrl || !config.token) {
    setStatus("未登录", "请先登录以同步班次");
    return;
  }
  setStatus("同步中...");
  try {
    const resp = await authFetch("/shifts");
    const payload = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(payload?.error || `请求失败 (${resp.status})`);
    }
    shifts.value = payload?.shifts || [];
    lastUpdated.value = new Date().toLocaleTimeString();
    setStatus("已登录");
    syncReminders(shifts.value);
  } catch (err) {
    if (err instanceof Error && err.message === "登录失效") {
      return;
    }
    setStatus("连接失败", err instanceof Error ? err.message : "未知错误");
  }
}

async function fetchPeople() {
  peopleError.value = null;
  peopleMessage.value = null;
  if (!loggedIn.value) {
    peopleError.value = "请先登录";
    return;
  }
  peopleBusy.value = true;
  try {
    const resp = await authFetch("/people");
    const payload = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(payload?.error || `请求失败 (${resp.status})`);
    }
    people.value = payload?.people || [];
    peopleMessage.value = `已加载 ${people.value.length} 人`;
  } catch (err) {
    if (err instanceof Error && err.message === "登录失效") {
      return;
    }
    peopleError.value = err instanceof Error ? err.message : "未知错误";
  } finally {
    peopleBusy.value = false;
  }
}

async function fetchUsers() {
  userError.value = null;
  userMessage.value = null;
  if (!loggedIn.value) {
    userError.value = "请先登录";
    return;
  }
  userBusy.value = true;
  try {
    const resp = await authFetch("/users");
    const payload = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(payload?.error || `请求失败 (${resp.status})`);
    }
    users.value = payload?.users || [];
    userMessage.value = `已加载 ${users.value.length} 个用户`;
  } catch (err) {
    if (err instanceof Error && err.message === "登录失效") {
      return;
    }
    userError.value = err instanceof Error ? err.message : "未知错误";
  } finally {
    userBusy.value = false;
  }
}

async function fetchAuditLogs() {
  auditError.value = null;
  auditMessage.value = null;
  if (!loggedIn.value) {
    auditError.value = "请先登录";
    return;
  }
  auditBusy.value = true;
  try {
    const limit = Math.max(1, Math.min(500, Math.floor(auditLimit.value || 100)));
    auditLimit.value = limit;
    const resp = await authFetch(`/audit-logs?limit=${limit}`);
    const payload = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(payload?.error || `请求失败 (${resp.status})`);
    }
    auditLogs.value = payload?.logs || [];
    auditMessage.value = `已加载 ${auditLogs.value.length} 条日志`;
  } catch (err) {
    if (err instanceof Error && err.message === "登录失效") {
      return;
    }
    auditError.value = err instanceof Error ? err.message : "未知错误";
  } finally {
    auditBusy.value = false;
  }
}

function setAuditLimit(value: number) {
  if (!Number.isFinite(value)) return;
  auditLimit.value = Math.max(1, Math.min(500, Math.floor(value)));
}

function startShiftEdit(shift: Shift) {
  shiftForm.id = shift.id;
  shiftForm.person_id = shift.person_id;
  const startParts = toLocalDateTimeParts(shift.start_at);
  const endParts = toLocalDateTimeParts(shift.end_at);
  shiftForm.start_date = startParts.date;
  shiftForm.start_time = startParts.time;
  shiftForm.end_date = endParts.date;
  shiftForm.end_time = endParts.time;
  shiftMessage.value = null;
  shiftError.value = null;
}

function resetShiftForm() {
  shiftForm.id = "";
  shiftForm.person_id = "";
  shiftForm.start_date = "";
  shiftForm.start_time = "";
  shiftForm.end_date = "";
  shiftForm.end_time = "";
}

async function saveShift() {
  shiftError.value = null;
  shiftMessage.value = null;
  if (!loggedIn.value) {
    shiftError.value = "请先登录";
    return;
  }
  if (!shiftForm.person_id || !shiftForm.start_date || !shiftForm.start_time || !shiftForm.end_date || !shiftForm.end_time) {
    shiftError.value = "请填写人员与开始/结束时间";
    return;
  }
  const startDate = parseLocalDateTime(shiftForm.start_date, shiftForm.start_time);
  const endDate = parseLocalDateTime(shiftForm.end_date, shiftForm.end_time);
  if (!startDate || !endDate) {
    shiftError.value = "时间格式无效";
    return;
  }
  if (endDate <= startDate) {
    shiftError.value = "结束时间必须晚于开始时间";
    return;
  }
  shiftBusy.value = true;
  try {
    const payload = {
      person_id: shiftForm.person_id,
      start_at: startDate.toISOString(),
      end_at: endDate.toISOString(),
    };
    const method = shiftForm.id ? "PUT" : "POST";
    const path = shiftForm.id ? `/shifts/${shiftForm.id}` : "/shifts";
    const resp = await authFetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(body?.error || `请求失败 (${resp.status})`);
    }
    shiftMessage.value = shiftForm.id ? "班次已更新" : "班次已创建";
    resetShiftForm();
    await fetchShifts();
  } catch (err) {
    if (err instanceof Error && err.message === "登录失效") {
      return;
    }
    shiftError.value = err instanceof Error ? err.message : "未知错误";
  } finally {
    shiftBusy.value = false;
  }
}

async function removeShift(shift: Shift) {
  shiftError.value = null;
  shiftMessage.value = null;
  if (!loggedIn.value) {
    shiftError.value = "请先登录";
    return;
  }
  if (!confirm(`确认删除 ${decodeName(shift.person_name_b64)} 的班次？`)) {
    return;
  }
  shiftBusy.value = true;
  try {
    const resp = await authFetch(`/shifts/${shift.id}`, { method: "DELETE" });
    const body = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(body?.error || `请求失败 (${resp.status})`);
    }
    shiftMessage.value = "班次已删除";
    await fetchShifts();
  } catch (err) {
    if (err instanceof Error && err.message === "登录失效") {
      return;
    }
    shiftError.value = err instanceof Error ? err.message : "未知错误";
  } finally {
    shiftBusy.value = false;
  }
}

function resetUserForms() {
  userCreateForm.username = "";
  userCreateForm.person_name = "";
  userCreateForm.password = "";
  userCreateForm.is_admin = false;
  userEditForm.id = "";
  userEditForm.username = "";
  userEditForm.person_name = "";
  userEditForm.is_admin = false;
  userResetForm.user_id = "";
  userResetForm.new_password = "";
}

function pickUser(user: User) {
  userEditForm.id = user.id;
  userEditForm.username = user.username;
  userEditForm.person_name = decodeName(user.person_name_b64);
  userEditForm.is_admin = user.is_admin;
}

function findUserById(id: string) {
  return users.value.find((user) => user.id === id);
}

async function createUser() {
  userError.value = null;
  userMessage.value = null;
  if (!loggedIn.value) {
    userError.value = "请先登录";
    return;
  }
  if (!userCreateForm.username || !userCreateForm.person_name || !userCreateForm.password) {
    userError.value = "请填写用户名、姓名与密码";
    return;
  }
  userBusy.value = true;
  try {
    const passwordHash = await hashPassword(userCreateForm.username, userCreateForm.password);
    const resp = await authFetch("/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: userCreateForm.username,
        person_name: userCreateForm.person_name,
        password_client_hash: passwordHash,
        is_admin: userCreateForm.is_admin,
      }),
    });
    const body = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(body?.error || `请求失败 (${resp.status})`);
    }
    userMessage.value = "用户已创建";
    resetUserForms();
    await fetchUsers();
    await fetchPeople();
  } catch (err) {
    if (err instanceof Error && err.message === "登录失效") {
      return;
    }
    userError.value = err instanceof Error ? err.message : "未知错误";
  } finally {
    userBusy.value = false;
  }
}

async function updateUser() {
  userError.value = null;
  userMessage.value = null;
  if (!loggedIn.value) {
    userError.value = "请先登录";
    return;
  }
  if (!userEditForm.id) {
    userError.value = "请选择要更新的用户";
    return;
  }
  if (!userEditForm.person_name) {
    userError.value = "姓名不能为空";
    return;
  }
  userBusy.value = true;
  try {
    const resp = await authFetch(`/users/${userEditForm.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_name: userEditForm.person_name,
        is_admin: userEditForm.is_admin,
      }),
    });
    const body = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(body?.error || `请求失败 (${resp.status})`);
    }
    userMessage.value = "用户已更新";
    await fetchUsers();
    await fetchPeople();
  } catch (err) {
    if (err instanceof Error && err.message === "登录失效") {
      return;
    }
    userError.value = err instanceof Error ? err.message : "未知错误";
  } finally {
    userBusy.value = false;
  }
}

async function removeUser(user: User) {
  userError.value = null;
  userMessage.value = null;
  if (!loggedIn.value) {
    userError.value = "请先登录";
    return;
  }
  if (!confirm(`确认删除用户 ${user.username}？`)) {
    return;
  }
  userBusy.value = true;
  try {
    const resp = await authFetch(`/users/${user.id}`, { method: "DELETE" });
    const body = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(body?.error || `请求失败 (${resp.status})`);
    }
    userMessage.value = "用户已删除";
    await fetchUsers();
    await fetchPeople();
  } catch (err) {
    if (err instanceof Error && err.message === "登录失效") {
      return;
    }
    userError.value = err instanceof Error ? err.message : "未知错误";
  } finally {
    userBusy.value = false;
  }
}

async function resetUserPassword() {
  userError.value = null;
  userMessage.value = null;
  if (!loggedIn.value) {
    userError.value = "请先登录";
    return;
  }
  if (!userResetForm.user_id || !userResetForm.new_password) {
    userError.value = "请选择用户并输入新密码";
    return;
  }
  const targetUser = findUserById(userResetForm.user_id);
  if (!targetUser) {
    userError.value = "用户不存在";
    return;
  }
  userBusy.value = true;
  try {
    const passwordHash = await hashPassword(targetUser.username, userResetForm.new_password);
    const resp = await authFetch(`/users/${userResetForm.user_id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password_client_hash: passwordHash }),
    });
    const body = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(body?.error || `请求失败 (${resp.status})`);
    }
    userMessage.value = "密码已重置";
    userResetForm.user_id = "";
    userResetForm.new_password = "";
  } catch (err) {
    if (err instanceof Error && err.message === "登录失效") {
      return;
    }
    userError.value = err instanceof Error ? err.message : "未知错误";
  } finally {
    userBusy.value = false;
  }
}

async function changePassword() {
  accountError.value = null;
  accountMessage.value = null;
  if (!loggedIn.value) {
    accountError.value = "请先登录";
    return;
  }
  if (!accountForm.current_password || !accountForm.new_password) {
    accountError.value = "请填写当前密码与新密码";
    return;
  }
  accountBusy.value = true;
  try {
    const currentHash = await hashPassword(config.username, accountForm.current_password);
    const newHash = await hashPassword(config.username, accountForm.new_password);
    const resp = await authFetch("/auth/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        current_password_client_hash: currentHash,
        new_password_client_hash: newHash,
      }),
    });
    const body = await parseJsonResponse(resp);
    if (!resp.ok) {
      throw new Error(body?.error || `请求失败 (${resp.status})`);
    }
    accountMessage.value = "密码已修改，请重新登录";
    accountForm.current_password = "";
    accountForm.new_password = "";
    clearSession("未登录", "密码已修改，请重新登录");
  } catch (err) {
    if (err instanceof Error && err.message === "登录失效") {
      return;
    }
    accountError.value = err instanceof Error ? err.message : "未知错误";
  } finally {
    accountBusy.value = false;
  }
}

function activateSection(next: SectionId) {
  resetMessages();
  const meta = navItems.find((item) => item.id === next);
  if (!meta) return;
  if (meta.auth && !loggedIn.value) {
    setStatus("未登录", "请先登录以使用管理功能");
    activeSection.value = "overview";
    return;
  }
  if (meta.admin && !isAdmin.value) {
    setStatus(status.value, "需要管理员权限");
    activeSection.value = "overview";
    return;
  }
  activeSection.value = next;
  if (next === "shifts") {
    fetchShifts();
    if (!people.value.length) {
      fetchPeople();
    }
  }
  if (next === "people") {
    fetchPeople();
  }
  if (next === "users") {
    fetchUsers();
  }
  if (next === "audit") {
    fetchAuditLogs();
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
    <div class="max-w-6xl mx-auto px-6 py-10 space-y-8">
      <header class="space-y-3">
        <div class="flex items-center gap-3">
          <div class="badge badge-outline badge-lg">Shift Desk</div>
          <span class="text-sm text-base-content/60">排班控制台</span>
        </div>
        <h1 class="text-3xl md:text-4xl font-semibold">排班桌面管理</h1>
        <p class="text-base text-base-content/70 max-w-2xl">
          即将到来的班次与本地提醒仍然保留，同时补齐前台管理操作入口。
        </p>
      </header>

      <section class="grid lg:grid-cols-[220px_1fr] gap-6">
        <aside class="card bg-base-100 shadow-xl border border-base-200 h-fit">
          <div class="card-body space-y-3">
            <div class="text-xs text-base-content/60">
              当前状态：<span class="font-semibold">{{ status }}</span>
            </div>
            <div class="space-y-2">
              <button
                v-for="item in navItems"
                :key="item.id"
                v-show="!item.admin || isAdmin"
                class="btn btn-ghost justify-start"
                :class="item.id === activeSection ? 'btn-active' : ''"
                @click="activateSection(item.id)"
              >
                {{ item.label }}
              </button>
            </div>
            <div v-if="!loggedIn" class="text-xs text-error">请先登录后使用管理功能。</div>
            <div v-else-if="!isAdmin" class="text-xs text-base-content/60">
              管理员功能仅管理员账号可见。
            </div>
          </div>
        </aside>

        <div class="space-y-6">
          <OverviewSection
            v-if="activeSection === 'overview'"
            :config="config"
            :login-form="loginForm"
            :status="status"
            :logged-in="loggedIn"
            :login-busy="loginBusy"
            :refresh-error="refreshError"
            :notification-ready="notificationReady"
            :upcoming-count="upcomingCount"
            :last-updated="lastUpdated"
            :shifts="shifts"
            @login="login"
            @logout="logout"
            @persist="persistConfig"
            @refresh="fetchShifts"
          />

          <ShiftsSection
            v-else-if="activeSection === 'shifts'"
            :shifts="shifts"
            :people="people"
            :shift-form="shiftForm"
            :shift-error="shiftError"
            :shift-message="shiftMessage"
            :shift-busy="shiftBusy"
            :people-busy="peopleBusy"
            @refresh-shifts="fetchShifts"
            @refresh-people="fetchPeople"
            @save-shift="saveShift"
            @reset-shift-form="resetShiftForm"
            @edit-shift="startShiftEdit"
            @remove-shift="removeShift"
          />

          <PeopleSection
            v-else-if="activeSection === 'people'"
            :people="people"
            :people-error="peopleError"
            :people-message="peopleMessage"
            :people-busy="peopleBusy"
            @refresh-people="fetchPeople"
          />

          <UsersSection
            v-else-if="activeSection === 'users'"
            :users="users"
            :user-create-form="userCreateForm"
            :user-edit-form="userEditForm"
            :user-reset-form="userResetForm"
            :user-error="userError"
            :user-message="userMessage"
            :user-busy="userBusy"
            @refresh-users="fetchUsers"
            @pick-user="pickUser"
            @create-user="createUser"
            @update-user="updateUser"
            @remove-user="removeUser"
            @reset-user-password="resetUserPassword"
          />

          <AuditSection
            v-else-if="activeSection === 'audit'"
            :audit-logs="auditLogs"
            :audit-limit="auditLimit"
            :audit-error="auditError"
            :audit-message="auditMessage"
            :audit-busy="auditBusy"
            @refresh-audit-logs="fetchAuditLogs"
            @update-limit="setAuditLimit"
          />

          <AccountSection
            v-else-if="activeSection === 'account'"
            :username="config.username"
            :logged-in="loggedIn"
            :account-form="accountForm"
            :account-error="accountError"
            :account-message="accountMessage"
            :account-busy="accountBusy"
            @change-password="changePassword"
            @logout="logout"
          />
        </div>
      </section>

      <footer class="text-xs text-base-content/60">
        提醒默认提前 15 分钟触发，应用关闭主窗口后仍会在后台运行，直到显式退出。
      </footer>
    </div>
  </div>
</template>
