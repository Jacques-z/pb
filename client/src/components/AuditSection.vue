<script setup lang="ts">
import type { AuditLog } from "../lib/types";
import { formatTime, shortId } from "../lib/format";

defineProps<{
  auditLogs: AuditLog[];
  auditLimit: number;
  auditError: string | null;
  auditMessage: string | null;
  auditBusy: boolean;
}>();

const emit = defineEmits<{
  (event: "refreshAuditLogs"): void;
  (event: "updateLimit", value: number): void;
}>();
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold">审计日志</h2>
      <button class="btn btn-ghost" @click="emit('refreshAuditLogs')" :disabled="auditBusy">
        刷新日志
      </button>
    </div>
    <div class="card bg-base-100 shadow-xl border border-base-200">
      <div class="card-body space-y-4">
        <div class="flex flex-wrap gap-3 items-end">
          <label class="form-control">
            <div class="label">
              <span class="label-text">加载条数</span>
            </div>
            <input
              :value="auditLimit"
              class="input input-bordered"
              type="number"
              min="1"
              max="500"
              @input="emit('updateLimit', Number(($event.target as HTMLInputElement).value))"
            />
          </label>
          <button class="btn btn-primary" :disabled="auditBusy" @click="emit('refreshAuditLogs')">
            读取日志
          </button>
        </div>
        <div v-if="auditError" class="text-xs text-error">{{ auditError }}</div>
        <div v-if="auditMessage" class="text-xs text-success">{{ auditMessage }}</div>
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作者</th>
                <th>动作</th>
                <th>资源</th>
                <th>请求</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="log in auditLogs" :key="log.id">
                <td>{{ formatTime(log.occurred_at) }}</td>
                <td>{{ log.actor_username || "--" }}</td>
                <td>{{ log.action }}</td>
                <td>{{ log.resource_type }} · {{ shortId(log.resource_id) }}</td>
                <td>{{ log.request_method }} {{ log.request_path }}</td>
                <td>{{ log.status_code }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
