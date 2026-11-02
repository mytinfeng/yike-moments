<template>
  <Teleport to="body">
    <div v-if="store.lightbox.open" class="lightbox" @click.self="close">
      <i class="ri-close-line lightbox-close" @click="close"></i>
      <div v-if="images.length > 1" class="lightbox-nav lightbox-prev" @click.stop="prev">
        <i class="ri-arrow-left-s-line"></i>
      </div>
      <img :src="images[index]" alt="" @click.stop />
      <div v-if="images.length > 1" class="lightbox-nav lightbox-next" @click.stop="next">
        <i class="ri-arrow-right-s-line"></i>
      </div>
      <div v-if="images.length > 1" class="lightbox-count">{{ index + 1 }} / {{ images.length }}</div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { store } from '../store.js';

const images = computed(() => store.lightbox.images || []);
const index = computed({
  get: () => store.lightbox.index || 0,
  set: (v) => (store.lightbox.index = v),
});

function close() {
  store.lightbox.open = false;
}
function prev() {
  index.value = (index.value - 1 + images.value.length) % images.value.length;
}
function next() {
  index.value = (index.value + 1) % images.value.length;
}
function onKey(e) {
  if (!store.lightbox.open) return;
  if (e.key === 'Escape') close();
  if (e.key === 'ArrowLeft') prev();
  if (e.key === 'ArrowRight') next();
}

onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));

watch(
  () => store.lightbox.open,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : '';
  }
);
</script>
