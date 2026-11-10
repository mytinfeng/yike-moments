<template>
  <div class="kehua-content-right-img" :class="[gridClass, { 'is-blurred': locked }]">
    <a
      v-for="(img, i) in visible"
      :key="img + i"
      class="kehua-content-right-img-pic"
      href="javascript:void(0)"
      @click.prevent="onPick(i)"
    >
      <img v-lazy="img" alt="" />
      <span v-if="i === visible.length - 1 && restCount > 0" class="img-count-mask">+{{ restCount }}</span>
    </a>

    <!-- 遮罩层铺在整组图上：点一下就解锁，解锁后再点才是看大图 -->
    <button v-if="locked" type="button" class="img-blur-cover" @click.stop="reveal">
      <i class="ri-eye-off-line"></i>
      <b>内容已遮罩</b>
      <span>点击查看</span>
    </button>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  images: { type: Array, default: () => [] },
  limit: { type: Number, default: 9 },
  /* 发布时勾了「图片遮罩」：先糊住，点一下才显示 */
  blurred: { type: Boolean, default: false },
});

const emit = defineEmits(['open']);

const revealed = ref(false);
const locked = computed(() => props.blurred && !revealed.value);

function reveal() {
  revealed.value = true;
}

function onPick(i) {
  if (locked.value) {
    reveal();
    return;
  }
  emit('open', i);
}

/* 同一条动态被编辑成「取消遮罩」时，状态要跟着回正 */
watch(
  () => props.blurred,
  () => {
    revealed.value = false;
  }
);

const visible = computed(() => props.images.slice(0, props.limit));
const restCount = computed(() => Math.max(0, props.images.length - props.limit));
const gridClass = computed(() => {
  const n = props.images.length;
  if (n === 1) return 'is-single';
  if (n === 2 || n === 4) return 'cols-2';
  return 'cols-3';
});
</script>
