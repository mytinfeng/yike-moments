<template>
  <div
    v-show="store.player.visible && !!track"
    ref="boxRef"
    class="pyq-float-player"
    :class="{ playing: playing }"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    @pointerdown="startDrag"
  >
    <div class="pyq-float-cover">
      <img :src="track?.cover || store.settings.avatar" alt="" />
      <div class="disc"></div>
    </div>
    <div class="pyq-float-bar">
      <div class="pyq-float-bar-bg" :style="{ width: progress + '%' }"></div>
    </div>
    <div class="pyq-float-inner" @pointerdown.stop>
      <i :class="playing ? 'ri-pause-fill' : 'ri-play-fill'" :title="playing ? '暂停' : '播放'" @click.stop="toggle"></i>
      <i class="ri-close-line" title="关闭" @click.stop="stop"></i>
    </div>
    <audio ref="audioRef" preload="none" @timeupdate="onTime" @ended="onEnded" @play="playing = true" @pause="playing = false"></audio>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { store } from '../store.js';

const audioRef = ref(null);
const boxRef = ref(null);
const playing = ref(false);
const progress = ref(0);
const track = computed(() => store.player.track);

const pos = reactive({ x: 18, y: 0 });
const BOX_W = 58;
const BOX_H = 96;

function resetPos() {
  const h = window.innerHeight;
  pos.x = 18;
  pos.y = h - BOX_H - 24;
}

function load(t) {
  const audio = audioRef.value;
  if (!audio || !t) return;
  audio.src = t.url;
  audio.volume = 0.85;
  audio.play().catch(() => {
    playing.value = false;
  });
  playing.value = true;
  progress.value = 0;
  store.player.visible = true;
}
function toggle() {
  const audio = audioRef.value;
  if (!audio) return;
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
}
function stop() {
  const audio = audioRef.value;
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
  playing.value = false;
  progress.value = 0;
  store.player.visible = false;
  store.player.track = null;
}
function onTime() {
  const audio = audioRef.value;
  if (!audio || !audio.duration) return;
  progress.value = (audio.currentTime / audio.duration) * 100;
  store.player.currentTime = audio.currentTime;
  store.player.duration = audio.duration;
}
function onEnded() {
  playing.value = false;
  progress.value = 0;
}

/* 拖动 */
let dragging = false;
let offset = { x: 0, y: 0 };
function startDrag(e) {
  if (e.target.closest('.pyq-float-inner')) return;
  dragging = true;
  offset = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  window.addEventListener('pointermove', onDrag);
  window.addEventListener('pointerup', endDrag);
}
function onDrag(e) {
  if (!dragging) return;
  pos.x = Math.min(Math.max(4, e.clientX - offset.x), window.innerWidth - BOX_W - 4);
  pos.y = Math.min(Math.max(4, e.clientY - offset.y), window.innerHeight - BOX_H - 4);
}
function endDrag() {
  dragging = false;
  window.removeEventListener('pointermove', onDrag);
  window.removeEventListener('pointerup', endDrag);
}

onMounted(() => {
  resetPos();
  store.playerApi = {
    load,
    toggle,
    stop,
    get playing() {
      return playing.value;
    },
  };
  // 站点背景音乐：只准备音源，等用户点击播放
  if (store.player.track && audioRef.value) {
    audioRef.value.src = store.player.track.url;
  }
  window.addEventListener('resize', () => {
    pos.x = Math.min(pos.x, window.innerWidth - BOX_W - 4);
    pos.y = Math.min(pos.y, window.innerHeight - BOX_H - 4);
  });
});

watch(playing, (v) => {
  store.player.playing = v;
});

watch(
  () => store.player.track,
  (t) => {
    const audio = audioRef.value;
    if (!audio || !t) return;
    const abs = new URL(t.url, window.location.origin).href;
    if (audio.src !== abs) {
      audio.pause();
      audio.src = t.url;
      playing.value = false;
      progress.value = 0;
    }
  }
);
onBeforeUnmount(() => {
  store.playerApi = null;
  store.player.playing = false;
});
</script>
