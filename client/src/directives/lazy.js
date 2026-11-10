/**
 * v-lazy —— 图片懒加载
 *
 * 用法：
 *   <img v-lazy="url" alt="">         滚动到附近才真正请求
 *   <img v-lazy.eager="url" alt="">   首屏关键图（封面、头像），立即加载
 *
 * 为什么不用原生的 loading="lazy"：
 * Chrome 的懒加载阈值很大（快网下离视口 2500px 就开始请求），首页十几条动态
 * 几十张图会一次性全部下载 + 解码，滚动自然发涩。这里用 IntersectionObserver
 * 把触发距离收到 300px，并且**只改 src、不改 DOM 结构**——不然
 * `.kehua-content-right-img-pic > img` 这类选择器会失效，样式会崩。
 *
 * 为什么要往上找「锚点」再观察：
 * 单图动态的尺寸完全由图片内在尺寸决定，图片没加载时 <img> 是 0×0。
 * IntersectionObserver 对 0 面积的目标不会在滚动进视口时回调（只在首次
 * observe 时给一次），结果就是「往下滚才出现的单图帖子，图永远加载不出来」。
 * 所以这里改观察最近的、真正占位的祖先元素，回调后再唤醒图片。
 */

const ATTR = 'data-lazy-src';
const ROOT_MARGIN = '300px 0px';
const MAX_UP = 5;

let io = null;
/* 观察目标 -> 要唤醒的 <img> 列表（多张图可能共用同一个锚点） */
const watched = new WeakMap();

function observer() {
  if (io) return io;
  io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const imgs = watched.get(entry.target) || [entry.target];
        watched.delete(entry.target);
        io.unobserve(entry.target);
        for (const img of imgs) reveal(img);
      }
    },
    { rootMargin: ROOT_MARGIN, threshold: 0 }
  );
  return io;
}

function reveal(el) {
  const url = el.getAttribute(ATTR);
  if (!url) return;
  el.removeAttribute(ATTR);
  el.__lazyRevealed = true;
  el.setAttribute('src', url);
}

/* 往上找第一个有实际尺寸的祖先当观察目标，找不到就观察自己 */
function anchorOf(el) {
  let node = el;
  for (let i = 0; i < MAX_UP && node; i++) {
    const r = node.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return node;
    node = node.parentElement;
  }
  return el;
}

function watch(el) {
  const target = anchorOf(el);
  const list = watched.get(target);
  if (list) {
    if (!list.includes(el)) list.push(el);
  } else {
    watched.set(target, [el]);
  }
  el.__lazyAnchor = target;
  observer().observe(target);
}

function unwatch(el) {
  const target = el.__lazyAnchor;
  if (!target) return;
  const list = watched.get(target);
  if (list) {
    const i = list.indexOf(el);
    if (i >= 0) list.splice(i, 1);
    if (!list.length) {
      watched.delete(target);
      if (io) io.unobserve(target);
    }
  } else if (io) {
    io.unobserve(target);
  }
  el.__lazyAnchor = null;
}

function bindOnce(el) {
  if (el.__lazyBound) return;
  el.__lazyBound = true;
  el.setAttribute('decoding', 'async');
  /* 淡入只在第一次出现时做，换图（编辑动态）不要再闪一下 */
  el.addEventListener('load', () => el.classList.add('lazy-done'));
  el.addEventListener('error', () => {
    el.classList.add('lazy-done');
    el.classList.add('lazy-fail');
  });
}

function setSource(el, url, eager) {
  bindOnce(el);
  el.classList.add('lazy-img');
  if (!url) {
    el.removeAttribute(ATTR);
    el.removeAttribute('src');
    return;
  }
  if (eager || el.__lazyRevealed || !('IntersectionObserver' in window)) {
    el.__lazyRevealed = true;
    el.setAttribute('src', url);
    return;
  }
  el.setAttribute(ATTR, url);
  /* src 留空，浏览器就不会提前请求；容量够时再交给 observer 唤醒 */
  if (!el.getAttribute('src')) el.removeAttribute('src');
  watch(el);
}

export default {
  mounted(el, binding) {
    el.__lazyUrl = binding.value;
    setSource(el, binding.value, !!binding.modifiers.eager);
  },
  updated(el, binding) {
    if (binding.value === el.__lazyUrl) return;
    el.__lazyUrl = binding.value;
    el.classList.remove('lazy-done');
    unwatch(el);
    setSource(el, binding.value, !!binding.modifiers.eager);
  },
  unmounted(el) {
    el.__lazyRevealed = false;
    unwatch(el);
  },
};
