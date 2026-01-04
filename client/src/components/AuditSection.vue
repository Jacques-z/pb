<script setup lang="ts">
import { computed } from "vue";
import type { AuditLog, Shift } from "../lib/types";
import { formatTime, shortId } from "../lib/format";

const props = defineProps<{
  auditLogs: AuditLog[];
  auditShiftIndex: Record<string, Shift>;
  auditLimit: number;
  auditError: string | null;
  auditMessage: string | null;
  auditBusy: boolean;
}>();

const emit = defineEmits<{
  (event: "refreshAuditLogs"): void;
  (event: "updateLimit", value: number): void;
}>();

const logMarkers = computed(() => {
  const markers = new Map<string, { marked: boolean; label: string }>();
  props.auditLogs.forEach((log) => {
    markers.set(log.id, buildMarker(log));
  });
  return markers;
});

function buildMarker(log: AuditLog) {
  if (log.action === "shifts.delete") {
    return { marked: true, label: "删除" };
  }
  if (log.action !== "shifts.create" && log.action !== "shifts.update") {
    return { marked: false, label: "" };
  }
  if (!log.resource_id) {
    return { marked: false, label: "" };
  }
  const shift = props.auditShiftIndex[log.resource_id];
  if (!shift) {
    return { marked: false, label: "" };
  }
  const occurredAt = Date.parse(log.occurred_at);
  const startAt = Date.parse(shift.start_at);
  const endAt = Date.parse(shift.end_at);
  if (!Number.isFinite(occurredAt) || !Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    return { marked: false, label: "" };
  }
  const isPast = startAt < occurredAt || endAt < occurredAt;
  return { marked: isPast, label: "过去" };
}
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
              <tr
                v-for="log in auditLogs"
                :key="log.id"
                :class="logMarkers.get(log.id)?.marked ? 'bg-error/5' : ''"
              >
                <td>{{ formatTime(log.occurred_at) }}</td>
                <td>{{ log.actor_username || "--" }}</td>
                <td>
                  <span>{{ log.action }}</span>
                  <span
                    v-if="logMarkers.get(log.id)?.marked"
                    class="badge badge-error badge-outline ml-2"
                  >
                    {{ logMarkers.get(log.id)?.label }}
                  </span>
                </td>
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
