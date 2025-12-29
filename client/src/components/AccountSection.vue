<script setup lang="ts">
defineProps<{
  username: string;
  loggedIn: boolean;
  accountForm: {
    current_password: string;
    new_password: string;
  };
  accountError: string | null;
  accountMessage: string | null;
  accountBusy: boolean;
}>();

const emit = defineEmits<{
  (event: "changePassword"): void;
  (event: "logout"): void;
}>();
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-xl font-semibold">账号设置</h2>
      <span class="text-xs text-base-content/60">{{ username || "未登录" }}</span>
    </div>
    <div class="grid md:grid-cols-2 gap-6">
      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body space-y-3">
          <h3 class="card-title">修改密码</h3>
          <label class="form-control">
            <div class="label">
              <span class="label-text">当前密码</span>
            </div>
            <input v-model="accountForm.current_password" class="input input-bordered" type="password" />
          </label>
          <label class="form-control">
            <div class="label">
              <span class="label-text">新密码</span>
            </div>
            <input v-model="accountForm.new_password" class="input input-bordered" type="password" />
          </label>
          <div v-if="accountError" class="text-xs text-error">{{ accountError }}</div>
          <div v-if="accountMessage" class="text-xs text-success">{{ accountMessage }}</div>
          <button class="btn btn-primary" :disabled="accountBusy" @click="emit('changePassword')">
            修改密码
          </button>
        </div>
      </div>

      <div class="card bg-base-100 shadow-xl border border-base-200">
        <div class="card-body space-y-3">
          <h3 class="card-title">会话控制</h3>
          <p class="text-sm text-base-content/70">修改密码后会自动清除当前会话并要求重新登录。</p>
          <button class="btn btn-outline" @click="emit('logout')" :disabled="!loggedIn">
            退出登录
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
