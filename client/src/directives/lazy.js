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
 */

const ATTR = 'data-lazy-src';
const ROOT_MARGIN = '300px 0px';

let io = null;

function observer() {
  if (io) return io;
  io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) reveal(entry.target);
      }
    },
    { rootMargin: ROOT_MARGIN, threshold: 0 }
  );
  return io;
}

function reveal(el) {
  const url = el.getAttribute(ATTR);
  if (io) io.unobserve(el);
  if (!url) return;
  el.removeAttribute(ATTR);
  el.__lazyRevealed = true;
  el.setAttribute('src', url);
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
  observer().observe(el);
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
    setSource(el, binding.value, !!binding.modifiers.eager);
  },
  unmounted(el) {
    el.__lazyRevealed = false;
    if (io) io.unobserve(el);
  },
};
