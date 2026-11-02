import { nextTick, onBeforeUnmount, onMounted } from 'vue';

/**
 * 滚动到底自动加载（无限滚动）
 * @param {import('vue').Ref<HTMLElement|null>} sentinelRef 列表底部的占位元素
 * @param {() => boolean} canLoad 现在还能不能继续加载（有更多 && 不在加载中）
 * @param {() => void} loadMore 加载下一页
 * @returns {{ fill: () => Promise<void> }} fill：内容不够撑满屏幕时手动补一次
 */
export function useInfiniteScroll(sentinelRef, canLoad, loadMore) {
  let io = null;

  /** 一页内容不够高时 observer 不会再触发，主动检查一次把屏幕铺满 */
  async function fill() {
    await nextTick();
    const el = sentinelRef.value;
    if (!el || !canLoad()) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight + 300) loadMore();
  }

  onMounted(() => {
    if (!('IntersectionObserver' in window)) return; // 老浏览器保留「加载更多」点击兜底
    io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && canLoad()) loadMore();
      },
      { rootMargin: '300px 0px' }
    );
    nextTick(() => sentinelRef.value && io.observe(sentinelRef.value));
  });

  onBeforeUnmount(() => {
    io?.disconnect();
    io = null;
  });

  return { fill };
}
