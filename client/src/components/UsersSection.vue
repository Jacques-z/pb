<script setup lang="ts">
import type { User } from "../lib/types";
import { decodeName } from "../lib/format";

defineProps<{
  users: User[];
  userCreateForm: {
    username: string;
    person_name: string;
    password: string;
    is_admin: boolean;
  };
  userEditForm: {
    id: string;
    username: string;
    person_name: string;
    is_admin: boolean;
  };
  userResetForm: {
    user_id: string;
    new_password: string;
  };
  userError: string | null;
  userMessage: string | null;
  userBusy: boolean;
}>();

const emit = defineEmits<{
  (event: "refreshUsers"): void;
  (event: "pickUser", user: User): void;
  (event: "createUser"): void;
  (event: "updateUser"): void;
  (event: "removeUser", user: User): void;
  (event: "resetUserPassword"): void;
}>();
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold">用户管理</h2>
      <button class="btn btn-ghost" @click="emit('refreshUsers')" :disabled="userBusy">
        刷新用户
      </button>
    </div>
    <div class="grid xl:grid-cols-[1.4fr_1fr] gap-6">
      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body space-y-4">
          <div class="flex items-center justify-between">
            <h3 class="card-title">用户列表</h3>
            <span class="text-xs text-base-content/60">共 {{ users.length }} 人</span>
          </div>
          <div v-if="userError" class="text-xs text-error">{{ userError }}</div>
          <div v-if="userMessage" class="text-xs text-success">{{ userMessage }}</div>
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th>用户名</th>
                  <th>姓名</th>
                  <th>管理员</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="user in users" :key="user.id">
                  <td>{{ user.username }}</td>
                  <td>{{ decodeName(user.person_name_b64) }}</td>
                  <td>{{ user.is_admin ? "是" : "否" }}</td>
                  <td class="space-x-2">
                    <button class="btn btn-xs btn-outline" @click="emit('pickUser', user)">
                      选择
                    </button>
                    <button class="btn btn-xs btn-error btn-outline" @click="emit('removeUser', user)">
                      删除
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="space-y-6">
        <div class="card bg-base-100 shadow-xl border border-base-200">
          <div class="card-body space-y-3">
            <h3 class="card-title">创建用户</h3>
            <label class="form-control">
              <div class="label">
                <span class="label-text">用户名</span>
              </div>
              <input
                v-model="userCreateForm.username"
                class="input input-bordered"
                type="text"
                placeholder="username"
              />
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">姓名</span>
              </div>
              <input
                v-model="userCreateForm.person_name"
                class="input input-bordered"
                type="text"
                placeholder="姓名"
              />
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">初始密码</span>
              </div>
              <input
                v-model="userCreateForm.password"
                class="input input-bordered"
                type="password"
                placeholder="••••••"
              />
            </label>
            <label class="cursor-pointer label justify-start gap-2">
              <input v-model="userCreateForm.is_admin" type="checkbox" class="checkbox" />
              <span class="label-text">设为管理员</span>
            </label>
            <button class="btn btn-primary" :disabled="userBusy" @click="emit('createUser')">
              创建用户
            </button>
          </div>
        </div>

        <div class="card bg-base-100 shadow-xl border border-base-200">
          <div class="card-body space-y-3">
            <h3 class="card-title">更新用户</h3>
            <label class="form-control">
              <div class="label">
                <span class="label-text">用户名（不可修改）</span>
              </div>
              <input
                v-model="userEditForm.username"
                class="input input-bordered"
                type="text"
                placeholder="请选择用户"
                disabled
              />
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">姓名</span>
              </div>
              <input
                v-model="userEditForm.person_name"
                class="input input-bordered"
                type="text"
                placeholder="姓名"
              />
            </label>
            <label class="cursor-pointer label justify-start gap-2">
              <input v-model="userEditForm.is_admin" type="checkbox" class="checkbox" />
              <span class="label-text">管理员权限</span>
            </label>
            <button class="btn btn-primary" :disabled="userBusy" @click="emit('updateUser')">
              保存更新
            </button>
          </div>
        </div>

        <div class="card bg-base-100 shadow-xl border border-base-200">
          <div class="card-body space-y-3">
            <h3 class="card-title">重置密码</h3>
            <label class="form-control">
              <div class="label">
                <span class="label-text">目标用户</span>
              </div>
              <select v-model="userResetForm.user_id" class="select select-bordered">
                <option disabled value="">请选择用户</option>
                <option v-for="user in users" :key="user.id" :value="user.id">
                  {{ user.username }} · {{ decodeName(user.person_name_b64) }}
                </option>
              </select>
            </label>
            <label class="form-control">
              <div class="label">
                <span class="label-text">新密码</span>
              </div>
              <input
                v-model="userResetForm.new_password"
                class="input input-bordered"
                type="password"
                placeholder="••••••"
              />
            </label>
            <button class="btn btn-primary" :disabled="userBusy" @click="emit('resetUserPassword')">
              重置密码
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
