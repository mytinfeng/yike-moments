<template>
  <div class="kehua-main-head">
    <div class="kehua-main-head-img">
      <!-- 视频封面 -->
      <template v-if="type === 'video' && video">
        <video class="cover-video" autoplay muted loop playsinline webkit-playsinline>
          <source :src="video" type="video/mp4" />
        </video>
      </template>

      <!-- 多图轮播 -->
      <template v-else-if="type === 'slideshow' && images.length">
        <div
          v-for="(img, i) in images"
          :key="img + i"
          class="cover-slide"
          :class="{ active: i === current }"
          :style="slideStyle(i, img)"
        ></div>
      </template>

      <!-- 单图 -->
      <template v-else>
        <img v-lazy.eager="image" class="cover-img" alt="封面" />
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { store } from '../store.js';

const type = computed(() => store.settings.cover_type || 'image');
const image = computed(() => store.settings.cover_image || '');
const video = computed(() => store.settings.cover_video || '');
const images = computed(() =>
  Array.isArray(store.settings.cover_images) ? store.settings.cover_images.filter(Boolean) : []
);
const current = ref(0);
let timer = null;

/* 轮播图是 background-image，浏览器无法懒加载：一次性把 N 张图都写成背景，
   等于首屏就吃掉 N 份带宽。这里只给「当前 + 下一张」挂背景，切换时再补。 */
const ready = ref(new Set([0, 1]));

function slideStyle(i, img) {
  const base = { backgroundSize: 'cover', backgroundPosition: 'center' };
  if (!ready.value.has(i)) return base;
  return { ...base, backgroundImage: `url("${String(img).replace(/"/g, '%22')}")` };
}

function ensureLoaded(i) {
  const next = new Set(ready.value);
  next.add(i);
  next.add((i + 1) % images.value.length);
  if (next.size === ready.value.size) return;
  ready.value = next;
}

function start() {
  stop();
  if (type.value !== 'slideshow' || images.value.length < 2) return;
  timer = setInterval(() => {
    current.value = (current.value + 1) % images.value.length;
  }, 5200);
}
function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}
onMounted(() => {
  start();
  ensureLoaded(0);
});
watch([type, images], start);
watch(current, ensureLoaded);
onBeforeUnmount(stop);
</script>
