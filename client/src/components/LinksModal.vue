<template>
  <Teleport to="body">
    <div v-if="store.linksOpen" class="pyq-mask" @click.self="store.linksOpen = false">
      <div class="pyq-dialog links-dialog">
        <div class="pyq-dialog-head">
          <h3>友情链接</h3>
          <button class="close" @click="store.linksOpen = false"><i class="ri-close-line"></i></button>
        </div>
        <div class="pyq-dialog-body">
          <div v-if="!links.length" class="search-tip">还没有添加友链</div>
          <div class="link-list">
            <a
              v-for="l in links"
              :key="l.id"
              class="link-item"
              :href="normalize(l.url)"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ l.name }}
            </a>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';

const links = ref([]);
let loaded = false;

watch(
  () => store.linksOpen,
  async (open) => {
    if (open && !loaded) {
      try {
        links.value = await api.get('/api/links');
        loaded = true;
      } catch {
        links.value = [];
      }
    }
  }
);

function normalize(url = '') {
  if (!url) return '#';
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
</script>

<style scoped>
.links-dialog {
  max-width: 380px;
}
</style>
