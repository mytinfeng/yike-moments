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

    <!-- 左下角：欢迎语（仅首次）/ 到访人数 / 彩蛋文案，每 2 秒换一条 -->
    <div v-if="currentLine" class="cover-visits">
      <!-- :duration 是兜底：万一 transitionend 没触发（后台标签页、掉帧），
           到点强制把旧元素摘掉，不至于越堆越多 -->
      <transition name="cv" appear :duration="380">
        <span :key="seq" class="cv-line">{{ currentLine }}</span>
      </transition>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { store, loadVisits } from '../store.js';
import { shortCount } from '../utils.js';

const type = computed(() => store.settings.cover_type || 'image');
const image = computed(() => store.settings.cover_image || '');
const video = computed(() => store.settings.cover_video || '');
const images = computed(() =>
  Array.isArray(store.settings.cover_images) ? store.settings.cover_images.filter(Boolean) : []
);

/* ---------------- 左下角文案轮播 ----------------
   欢迎语只在「第一次打开」时单独播一条，2 秒后并入随机池；
   池子里是「到访人数 + 所有彩蛋文案」，洗牌后依次播，播完一轮重新洗牌。 */
const VISIT_KEY = 'pyq_greeted'; // 首次来访标记（pyq_guest 是 HttpOnly，前端读不到）
const SWITCH_MS = 2000;

const currentLine = ref('');
const seq = ref(0); // 只用来给 <transition> 换 key，内容重复也要触发动画
let lineTimer = null;
let bootTimer = null;
let pool = [];
let cursor = 0;
let lastLine = '';

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 占位符替换：{site} → 站点名，{count} → 缩写后的到访人数 */
function fill(tpl) {
  return String(tpl || '')
    .replace(/\{site\}/g, String(store.settings.site_name || ''))
    .replace(/\{count\}/g, shortCount(store.visitCount));
}

function buildPool() {
  const out = [];
  const visitTpl = String(store.settings.cover_visit || '').trim();
  /* 访问数还没回来（0）就先不让它进池子，免得飘出「0位朋友到访过~」 */
  if (visitTpl && store.visitCount > 0) out.push(fill(visitTpl));
  for (const raw of String(store.settings.cover_lines || '').split('\n')) {
    const line = raw.trim();
    if (line) out.push(fill(line));
  }
  return out;
}

function nextLine() {
  if (!pool.length) return '';
  if (cursor >= pool.length) {
    pool = shuffle(pool);
    cursor = 0;
    /* 新一轮第一条别和上一轮的结尾撞，否则看着像"没换" */
    if (pool.length > 1 && pool[0] === lastLine) {
      [pool[0], pool[1]] = [pool[1], pool[0]];
    }
  }
  lastLine = pool[cursor];
  cursor += 1;
  seq.value += 1;
  return lastLine;
}

function stopLoop() {
  if (lineTimer) clearInterval(lineTimer);
  lineTimer = null;
}

function startLoop() {
  stopLoop();
  const first = nextLine();
  if (!first) return;
  currentLine.value = first;
  lineTimer = setInterval(() => {
    const line = nextLine();
    if (line) currentLine.value = line;
  }, SWITCH_MS);
}

function bootLines() {
  pool = buildPool();
  if (!pool.length) return;

  /* 清过 cookie 的访客：服务端当新人算，这里 localStorage 还在，就不再欢迎一次。
     宁可少播一句，也不要每次刷新都重新欢迎。 */
  let firstTime = false;
  try {
    firstTime = !localStorage.getItem(VISIT_KEY);
    localStorage.setItem(VISIT_KEY, '1');
  } catch {
    /* 隐私模式写不进去，按老访客处理 */
  }

  const welcome = fill(String(store.settings.cover_welcome || '').trim());
  if (firstTime && welcome) {
    seq.value += 1;
    currentLine.value = welcome;
    bootTimer = setTimeout(startLoop, SWITCH_MS);
    return;
  }
  startLoop();
}

/* ---------------- 轮播图（封面本身） ---------------- */
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

let disposed = false;
let booted = false;
let forceTimer = null;

function bootOnce() {
  if (booted || disposed || !store.ready) return;
  booted = true;
  if (forceTimer) clearTimeout(forceTimer);
  forceTimer = null;
  bootLines();
}

/* 词池要等两样东西：
   - store.ready：站点设置（没有它 cover_welcome / cover_lines 都是空的）
   - visitCount：到访人数（没有它池子里就缺「xx位朋友到访过~」）
   设置到了但人数迟迟不回（离线、接口挂了），给 1.2 秒缓冲就先拿彩蛋文案开场，
   宁可少一条到访语，也别让左下角一直空着。 */
watch(
  [() => store.ready, () => store.visitCount],
  ([ready, count]) => {
    if (!ready || booted) return;
    if (count > 0) return bootOnce();
    if (!forceTimer) forceTimer = setTimeout(bootOnce, 1200);
    return undefined;
  },
  { immediate: true }
);

onMounted(() => {
  start();
  ensureLoaded(0);
  loadVisits();
});

watch([type, images], start);
watch(current, ensureLoaded);

onBeforeUnmount(() => {
  disposed = true;
  stop();
  stopLoop();
  if (bootTimer) clearTimeout(bootTimer);
  if (forceTimer) clearTimeout(forceTimer);
});
</script>
