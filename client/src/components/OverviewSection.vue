<script setup lang="ts">
import type { Config, Shift } from "../lib/types";
import { decodeName, formatTime, shortId } from "../lib/format";

defineProps<{
  config: Config;
  loginForm: { username: string; password: string };
  status: string;
  loggedIn: boolean;
  loginBusy: boolean;
  refreshError: string | null;
  notificationReady: boolean;
  upcomingCount: number;
  lastUpdated: string;
  shifts: Shift[];
}>();

const emit = defineEmits<{
  (event: "login"): void;
  (event: "logout"): void;
  (event: "persist"): void;
  (event: "refresh"): void;
}>();
</script>

<template>
  <div class="grid lg:grid-cols-[1.1fr_1.5fr] gap-6">
    <div class="card bg-base-100 shadow-xl border border-base-200">
      <div class="card-body space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="card-title">连接配置</h2>
          <span class="badge" :class="loggedIn ? 'badge-success' : 'badge-ghost'">
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
          <button class="btn btn-primary" :disabled="loginBusy" @click="emit('login')">
            {{ loginBusy ? "登录中..." : "登录" }}
          </button>
          <button class="btn btn-ghost" @click="emit('logout')" :disabled="!loggedIn">
            退出登录
          </button>
          <button class="btn btn-ghost" @click="emit('persist')">保存设置</button>
          <button class="btn btn-ghost" @click="emit('refresh')" :disabled="!loggedIn">
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
              <span class="badge badge-outline">{{ shortId(shift.person_id) }}</span>
            </div>
            <div class="text-sm text-base-content/70">
              {{ formatTime(shift.start_at) }} → {{ formatTime(shift.end_at) }}
            </div>
            <div class="text-xs text-base-content/50">班次 ID: {{ shift.id }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
