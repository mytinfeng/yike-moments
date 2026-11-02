<template>
  <div class="kehua-content-right-img" :class="gridClass">
    <a
      v-for="(img, i) in visible"
      :key="img + i"
      class="kehua-content-right-img-pic"
      href="javascript:void(0)"
      @click.prevent="$emit('open', i)"
    >
      <img v-lazy="img" alt="" />
      <span v-if="i === visible.length - 1 && restCount > 0" class="img-count-mask">+{{ restCount }}</span>
    </a>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  images: { type: Array, default: () => [] },
  limit: { type: Number, default: 9 },
});

defineEmits(['open']);

const visible = computed(() => props.images.slice(0, props.limit));
const restCount = computed(() => Math.max(0, props.images.length - props.limit));
const gridClass = computed(() => {
  const n = props.images.length;
  if (n === 1) return 'is-single';
  if (n === 2 || n === 4) return 'cols-2';
  return 'cols-3';
});
</script>
