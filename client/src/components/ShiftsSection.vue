<script setup lang="ts">
import type { Person, Shift } from "../lib/types";
import { decodeName, formatTime, shortId, toLocalDateTimeParts, parseLocalDateTime } from "../lib/format";

const props = defineProps<{
  shifts: Shift[];
  people: Person[];
  shiftForm: {
    id: string;
    person_id: string;
    start_date: string;
    start_time: string;
    end_date: string;
    end_time: string;
  };
  shiftError: string | null;
  shiftMessage: string | null;
  shiftBusy: boolean;
  peopleBusy: boolean;
}>();

const emit = defineEmits<{
  (event: "refreshShifts"): void;
  (event: "refreshPeople"): void;
  (event: "saveShift"): void;
  (event: "resetShiftForm"): void;
  (event: "editShift", shift: Shift): void;
  (event: "removeShift", shift: Shift): void;
}>();

const shiftForm = props.shiftForm;

function setStartNow() {
  const parts = toLocalDateTimeParts(new Date().toISOString());
  shiftForm.start_date = parts.date;
  shiftForm.start_time = parts.time;
  if (!shiftForm.end_date || !shiftForm.end_time) {
    setEndFromStart(8);
  }
}

function copyStartToEnd() {
  if (!shiftForm.start_date || !shiftForm.start_time) return;
  shiftForm.end_date = shiftForm.start_date;
  shiftForm.end_time = shiftForm.start_time;
}

function setEndFromStart(hours: number) {
  if (!shiftForm.start_date || !shiftForm.start_time) return;
  const base = parseLocalDateTime(shiftForm.start_date, shiftForm.start_time);
  if (!base) return;
  const end = new Date(base.getTime() + hours * 60 * 60 * 1000);
  const parts = toLocalDateTimeParts(end.toISOString());
  shiftForm.end_date = parts.date;
  shiftForm.end_time = parts.time;
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold">班次管理</h2>
      <button class="btn btn-ghost" @click="emit('refreshShifts')" :disabled="shiftBusy">
        刷新班次
      </button>
    </div>
    <div class="grid xl:grid-cols-[1fr_1.4fr] gap-6">
      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body space-y-4">
          <h3 class="card-title">{{ shiftForm.id ? "编辑班次" : "创建班次" }}</h3>
          <div class="space-y-3">
            <label class="form-control">
              <div class="label">
                <span class="label-text">人员</span>
              </div>
              <select v-model="shiftForm.person_id" class="select select-bordered">
                <option disabled value="">请选择人员</option>
                <option v-for="person in people" :key="person.id" :value="person.id">
                  {{ decodeName(person.person_name_b64) }} · {{ shortId(person.id) }}
                </option>
              </select>
            </label>
            <div class="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <label class="form-control">
                <div class="label">
                  <span class="label-text">开始日期</span>
                </div>
                <input v-model="shiftForm.start_date" class="input input-bordered" type="date" />
              </label>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">开始时间</span>
                </div>
                <input
                  v-model="shiftForm.start_time"
                  class="input input-bordered"
                  type="time"
                  step="60"
                  lang="zh-CN"
                  placeholder="HH:mm"
                />
              </label>
              <button class="btn btn-outline btn-sm" type="button" @click="setStartNow">
                开始=现在
              </button>
            </div>
            <div class="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
              <label class="form-control">
                <div class="label">
                  <span class="label-text">结束日期</span>
                </div>
                <input v-model="shiftForm.end_date" class="input input-bordered" type="date" />
              </label>
              <label class="form-control">
                <div class="label">
                  <span class="label-text">结束时间</span>
                </div>
                <input
                  v-model="shiftForm.end_time"
                  class="input input-bordered"
                  type="time"
                  step="60"
                  lang="zh-CN"
                  placeholder="HH:mm"
                />
              </label>
              <div class="flex flex-wrap gap-2">
                <button class="btn btn-outline btn-sm" type="button" @click="copyStartToEnd">
                  结束=开始
                </button>
                <button class="btn btn-outline btn-sm" type="button" @click="setEndFromStart(8)">
                  结束+8h
                </button>
              </div>
            </div>
          </div>
          <div v-if="shiftError" class="text-xs text-error">{{ shiftError }}</div>
          <div v-if="shiftMessage" class="text-xs text-success">{{ shiftMessage }}</div>
          <div class="flex flex-wrap gap-2">
            <button class="btn btn-primary" :disabled="shiftBusy" @click="emit('saveShift')">
              {{ shiftForm.id ? "保存更新" : "创建班次" }}
            </button>
            <button class="btn btn-ghost" type="button" @click="emit('resetShiftForm')">
              清空表单
            </button>
            <button class="btn btn-ghost" type="button" @click="emit('refreshPeople')" :disabled="peopleBusy">
              刷新人员
            </button>
          </div>
          <div class="text-xs text-base-content/60">
            使用人员目录选择班次归属，日期与时间分别输入以避免兼容性问题。
          </div>
        </div>
      </div>

      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="card-title">即将到来的班次</h3>
            <span class="text-xs text-base-content/60">共 {{ shifts.length }} 条</span>
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
              <div class="flex flex-wrap gap-2">
                <button class="btn btn-xs btn-outline" @click="emit('editShift', shift)">
                  编辑
                </button>
                <button class="btn btn-xs btn-error btn-outline" @click="emit('removeShift', shift)">
                  删除
                </button>
              </div>
              <div class="text-xs text-base-content/50">班次 ID: {{ shift.id }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
