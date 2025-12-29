<script setup lang="ts">
import type { Person } from "../lib/types";
import { decodeName, formatTime } from "../lib/format";

defineProps<{
  people: Person[];
  peopleError: string | null;
  peopleMessage: string | null;
  peopleBusy: boolean;
}>();

const emit = defineEmits<{
  (event: "refreshPeople"): void;
}>();
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold">人员目录</h2>
      <button class="btn btn-ghost" @click="emit('refreshPeople')" :disabled="peopleBusy">
        刷新人员
      </button>
    </div>
    <div class="card bg-base-100 shadow-xl border border-base-200">
      <div class="card-body space-y-4">
        <div v-if="peopleError" class="text-xs text-error">{{ peopleError }}</div>
        <div v-if="peopleMessage" class="text-xs text-success">{{ peopleMessage }}</div>
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>姓名</th>
                <th>人员 ID</th>
                <th>创建时间</th>
                <th>更新时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="person in people" :key="person.id">
                <td>{{ decodeName(person.person_name_b64) }}</td>
                <td>{{ person.id }}</td>
                <td>{{ formatTime(person.created_at) }}</td>
                <td>{{ formatTime(person.updated_at) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>
