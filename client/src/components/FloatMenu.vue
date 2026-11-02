<template>
  <div class="kehua-menu">
    <div
      class="kehua-menu-k gp-entry"
      :class="{ done: hasProfile }"
      :title="hasProfile ? '信息登记（已登记，点击修改）' : '信息登记'"
      @click="openGuest"
    >
      <i class="ri-id-card-line"></i>
    </div>
    <div
      v-if="musicOn"
      class="kehua-menu-k"
      :class="{ playing: musicPlaying }"
      :title="musicPlaying ? '暂停背景音乐' : '播放背景音乐'"
      @click="toggleBgMusic"
    >
      <i :class="musicPlaying ? 'ri-music-2-fill' : 'ri-music-2-line'"></i>
    </div>
    <div class="kehua-menu-k" :title="dark ? '切换日间模式' : '切换夜间模式'" @click="toggleTheme">
      <i :class="dark ? 'ri-sun-line' : 'ri-moon-line'"></i>
    </div>
    <div class="kehua-menu-k" :class="{ hidden: !showTop }" title="返回顶部" @click="toTop">
      <i class="ri-arrow-up-line"></i>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { guestNickname, hasBgMusic, store, toggleBgMusic, toggleTheme } from '../store.js';

defineProps({ showTop: { type: Boolean, default: false } });

const dark = computed(() => store.themeDark);
const musicOn = computed(() => hasBgMusic());
const musicPlaying = computed(() => store.player.visible && store.player.playing);
/* 登记过昵称就把图标点亮，用户能一眼看出「我填过了」 */
const hasProfile = computed(() => !!guestNickname());

function openGuest() {
  store.guestOpen = true;
}

function toTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
</script>

<style scoped>
.gp-entry.done i {
  color: var(--theme);
}
</style>
