<template>
  <Teleport to="body">
    <div v-if="store.confirm.open" class="pyq-mask" @click.self="resolveConfirm(false)">
      <div class="pyq-dialog confirm-dialog">
        <div class="pyq-dialog-head">
          <h3>{{ store.confirm.title }}</h3>
          <button class="close" @click="resolveConfirm(false)"><i class="ri-close-line"></i></button>
        </div>
        <div class="pyq-dialog-body">
          <p class="confirm-text">{{ store.confirm.message }}</p>
          <div class="confirm-btns">
            <button class="btn-ghost" @click="resolveConfirm(false)">取消</button>
            <button class="btn-danger" :class="{ ghost: !store.confirm.danger }" @click="resolveConfirm(true)">
              {{ store.confirm.okText }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { store, resolveConfirm } from '../store.js';
</script>

<style>
.confirm-text {
  font-size: 14px;
  color: var(--textqh);
  line-height: 1.7;
  margin-bottom: 20px;
  white-space: pre-wrap;
}
.confirm-btns {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.btn-danger {
  background: #e74c3c;
  color: #fff;
  padding: 9px 20px;
  border-radius: 8px;
  font-size: 13.5px;
}
.btn-danger.ghost {
  background: var(--theme);
}
.confirm-dialog {
  max-width: 340px;
}
</style>
