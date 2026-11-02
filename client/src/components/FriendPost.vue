<template>
  <!-- 整张卡就是一条外链：点哪里都跳回原站，本站不做详情页 -->
  <a
    class="kehua-content fp"
    :href="item.url"
    target="_blank"
    rel="noopener noreferrer nofollow"
  >
    <div class="kehua-content-left">
      <img
        v-if="item.siteAvatar && !avaBroken"
        v-lazy.eager="item.siteAvatar"
        :alt="item.siteName"
        referrerpolicy="no-referrer"
        @error="avaBroken = true"
      />
      <span v-else class="fp-ava-txt">{{ (item.siteName || '友')[0] }}</span>
    </div>

    <div class="kehua-content-right">
      <div class="kehua-content-right-head">
        <div class="kehua-content-right-head-title">
          <div class="fp-title-left">
            <p class="fp-name">{{ item.siteName || '友站' }}</p>
            <span class="fp-tag" title="点一下，可以不看这个好友的内容" @click.stop.prevent="mute"
              >好友</span
            >
          </div>
        </div>

        <div v-if="item.excerpt" class="post-text fp-text">{{ item.excerpt }}</div>
        <p v-else class="post-text fp-dim">分享了 {{ item.images.length }} 张图片</p>

        <div v-if="item.images.length" class="kehua-content-right-img" :class="gridClass">
          <span v-for="(u, i) in item.images" :key="u + i" class="kehua-content-right-img-pic">
            <img v-lazy="u" alt="" referrerpolicy="no-referrer" @error="hideImg" />
          </span>
        </div>
      </div>

      <div class="kehua-content-right-time">
        <div class="kehua-content-right-time-left">
          <span>{{ timeAgo(item.created_at) }}</span>
          <span class="fp-from"
            >来自 {{ item.siteName || '友站' }}<i class="ri-external-link-line fp-ext"></i
          ></span>
        </div>
        <div class="fp-stat" title="在对方站点上评论">
          <i class="ri-chat-3-line"></i>{{ item.stats?.comments || 0 }}
        </div>
      </div>
    </div>
  </a>
</template>

<script setup>
import { computed, ref } from 'vue';
import { confirmDialog, muteFriendSite } from '../store.js';
import { timeAgo } from '../utils.js';

const props = defineProps({
  item: { type: Object, required: true },
});

const emit = defineEmits(['muted']);
const avaBroken = ref(false);

const gridClass = computed(() => {
  const n = props.item.images?.length || 0;
  if (n === 1) return 'is-single';
  if (n === 2 || n === 4) return 'cols-2';
  return 'cols-3';
});

function hideImg(e) {
  e.target.style.display = 'none';
}

async function mute() {
  const ok = await confirmDialog(
    `不看「${props.item.siteName}」的内容？\n\n隐藏后首页不再显示来自这个站点的动态，7 天内可以随时恢复。`,
    { title: '不看好友内容', okText: '不看', danger: false }
  );
  if (!ok) return;
  const list = muteFriendSite(props.item.siteId);
  emit('muted', list);
}
</script>

<style scoped>
/* 作为 <a> 使用时要抹掉链接的默认表现，否则整张卡是蓝字带下划线 */
.fp {
  color: inherit;
  text-decoration: none;
}
.fp:hover .fp-name {
  text-decoration: underline;
}

.fp-ava-txt {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 46px;
  border-radius: 4px;
  font-size: 19px;
  font-weight: 700;
  color: #fff;
  background: var(--theme);
}

/* 名字字号必须和本人动态一致（那边用的是 .kehua-content-right-head-title > p 的 15px/700，
   这里多包了一层 .fp-title-left，选择器不再命中，得手动对齐） */
.fp-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--thetitle);
  max-width: 70%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 名字和「好友」标签挨在一起，别被 space-between 推到行尾去 */
.fp-title-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

/* 和「广告 / 置顶」同尺寸的徽章，但做成可点击的 */
.fp-tag {
  flex-shrink: 0;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.6;
  color: var(--theme);
  background: var(--themetm);
  cursor: pointer;
  user-select: none;
}
.fp-tag:hover {
  border-color: var(--theme);
}

/* 摘要最多两行，多了会把本地动态顶下去 */
.fp-text {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-top: 4px;
}
.fp-dim {
  margin-top: 4px;
  color: var(--texths);
}

.fp-from {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 提示「点了会离开本站」 */
.fp-ext {
  font-size: 11px;
  opacity: 0.75;
}

.fp-stat {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--texths);
}
.fp-stat i {
  font-size: 13px;
}
</style>
