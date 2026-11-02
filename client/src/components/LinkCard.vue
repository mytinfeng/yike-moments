<template>
  <a
    class="link-card"
    :href="link.url"
    target="_blank"
    rel="noopener noreferrer nofollow"
    :title="link.url"
    @click.stop
  >
    <span class="link-card-icon">
      <img v-if="icon && !broken" :src="icon" alt="" loading="lazy" @error="broken = true" />
      <i v-else class="ri-global-line"></i>
    </span>
    <div class="link-card-info">
      <strong>{{ link.title || link.host || '网页链接' }}</strong>
      <p v-if="link.desc" class="desc">{{ link.desc }}</p>
      <span class="host"><i class="ri-link-m"></i>{{ link.host || hostOf(link.url) }}</span>
    </div>
    <i class="ri-arrow-right-s-line"></i>
  </a>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  link: { type: Object, required: true },
});

/* 图标加载失败（对方防盗链 / 已删图）就退回默认的地球图标 */
const broken = ref(false);
const icon = computed(() => props.link?.icon || '');
watch(icon, () => (broken.value = false));

function hostOf(url = '') {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}
</script>
