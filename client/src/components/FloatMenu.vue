<template>
  <div class="kehua-menu">
    <div class="gp-wrap">
      <div
        class="kehua-menu-k gp-entry"
        :class="{ done: hasProfile }"
        :title="hasProfile ? '信息登记（已登记，点击修改）' : '信息登记'"
        @click="openGuest"
      >
        <i class="ri-id-card-line"></i>
        <span v-if="showDot" class="gp-dot"></span>
      </div>

      <transition name="gp-hint">
        <div v-if="hintOn" class="gp-hint" role="button" @click="openFromHint">
          <span class="gp-hint-t">留个名字？</span>
          <span class="gp-hint-s">以后点赞、评论都显示你</span>
        </div>
      </transition>
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
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { guestNickname, hasBgMusic, store, toggleBgMusic, toggleTheme } from '../store.js';

const props = defineProps({
  showTop: { type: Boolean, default: false },
  /* 只有首页传 true：详情页/作者页是「从列表点进去」的，访客已经知道自己要看什么，
     再弹一个引导就是打扰 */
  guide: { type: Boolean, default: false },
});

const dark = computed(() => store.themeDark);
const musicOn = computed(() => hasBgMusic());
const musicPlaying = computed(() => store.player.visible && store.player.playing);
/* 登记过昵称就把图标点亮，用户能一眼看出「我填过了」 */
const hasProfile = computed(() => !!guestNickname());

/* ---------- 首次进站的引导气泡 ----------
   浮动菜单是 fixed 悬在正文上的，气泡只能往左弹，必然会压住正文右缘一块。
   所以「不打扰阅读」全靠时间控制：1.2 秒后出现、6 秒自动收、一滚动立刻退。 */
const HINT_KEY = 'pyq_gp_hint';
const HINT_DELAY = 1200;
const HINT_LIFE = 6000;
const HINT_SCROLL = 80;

const hintOn = ref(false);
const hinted = ref(false);
let started = false;
let appearTimer = null;
let lifeTimer = null;

/* 气泡收起来后才点小圆点，不然气泡还在的时候两个提示同时出现 */
const showDot = computed(
  () => hinted.value && !hintOn.value && !hasProfile.value && !store.user
);

function seenBefore() {
  try {
    return !!localStorage.getItem(HINT_KEY);
  } catch {
    /* 隐私模式下 localStorage 会抛异常：宁可不弹，也不要每次刷新都烦人 */
    return true;
  }
}

function markSeen() {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {}
  hinted.value = true;
}

function closeHint() {
  if (!hintOn.value) return;
  hintOn.value = false;
  if (lifeTimer) {
    clearTimeout(lifeTimer);
    lifeTimer = null;
  }
  window.removeEventListener('scroll', onHintScroll);
}

function onHintScroll() {
  if (window.scrollY > HINT_SCROLL) closeHint();
}

function startHint() {
  if (started) return;
  if (!props.guide || store.user || hasProfile.value || seenBefore()) return;
  started = true;
  appearTimer = setTimeout(() => {
    appearTimer = null;
    /* 用户已经滚下去看内容了，就别在此时弹一个指向固定按钮的气泡 */
    if (window.scrollY > HINT_SCROLL) return;
    hintOn.value = true;
    markSeen();
    window.addEventListener('scroll', onHintScroll, { passive: true });
    lifeTimer = setTimeout(() => {
      lifeTimer = null;
      closeHint();
    }, HINT_LIFE);
  }, HINT_DELAY);
}

function openGuest() {
  store.guestOpen = true;
}

/* 点气泡本身等于点图标：省掉「看到提示 → 再去找那个 38px 的圆」这一步 */
function openFromHint() {
  markSeen();
  closeHint();
  openGuest();
}

function toTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* 等登录态确定再判断：已登录的人不需要登记，气泡不该闪一下再消失 */
watch(
  () => store.ready,
  (v) => {
    if (v) startHint();
  },
  { immediate: true }
);

/* 弹窗从别处打开（比如评论框引导）时，气泡就别留在底下了 */
watch(
  () => store.guestOpen,
  (open) => {
    if (open) closeHint();
  }
);

onBeforeUnmount(() => {
  if (appearTimer) clearTimeout(appearTimer);
  if (lifeTimer) clearTimeout(lifeTimer);
  window.removeEventListener('scroll', onHintScroll);
});
</script>

<style scoped>
.gp-wrap {
  position: relative;
}
.gp-entry {
  position: relative;
}
.gp-entry.done i {
  color: var(--theme);
}

/* 气泡收起后留一个小圆点，给错过气泡的人第二次机会；登记完就没了。
   不设 pointer-events: none —— 图标是圆的，圆点有一半落在圆角外，
   设了穿透就点到父容器上，点圆点等于没点。让它自己是可点元素，
   事件冒泡给外层 .gp-entry 照样打开弹窗。 */
.gp-dot {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--theme);
}

.gp-hint {
  position: absolute;
  right: calc(100% + 10px);
  /* 垂直居中于第一个图标（38px 高，中心在 19px）。
     用 transform 而不是算死的 top 值：文案万一换行、气泡变高，也不会跟图标错开 */
  top: 19px;
  transform: translateY(-50%);
  z-index: 1;
  width: 150px;
  padding: 9px 12px 10px;
  border-radius: 10px;
  background: var(--cobg);
  border: 1px solid var(--fgxys);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 3px;
  cursor: pointer;
  user-select: none;
}
/* 指向图标的三角：旋转 45° 的方块，只留右侧和上侧的边 */
.gp-hint::after {
  content: '';
  position: absolute;
  right: -5px;
  top: 50%;
  width: 9px;
  height: 9px;
  margin-top: -5px;
  background: var(--cobg);
  border-top: 1px solid var(--fgxys);
  border-right: 1px solid var(--fgxys);
  border-radius: 1px;
  transform: rotate(45deg);
}
.gp-hint-t {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
  color: var(--textqh);
}
.gp-hint-s {
  font-size: 11px;
  line-height: 1.4;
  color: var(--texths);
}

/* 进入从右往左、退出继续往左，跟封面那行动态文案同一个方向 */
.gp-hint-enter-active,
.gp-hint-leave-active {
  transition: opacity 0.22s ease, transform 0.22s ease;
}
.gp-hint-enter-from {
  opacity: 0;
  transform: translateY(-50%) translateX(6px);
}
.gp-hint-leave-to {
  opacity: 0;
  transform: translateY(-50%) translateX(-4px);
}

@media (max-width: 600px) {
  /* 142px 时「以后点赞、评论都显示你」会挤成两行，气泡变胖、跟图标对不齐 */
  .gp-hint {
    width: 156px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .gp-hint-enter-active,
  .gp-hint-leave-active {
    transition: opacity 0.15s ease;
  }
  .gp-hint-enter-from,
  .gp-hint-leave-to {
    transform: translateY(-50%);
  }
}
</style>
