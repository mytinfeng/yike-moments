<template>
  <div class="comment-editor" @click.stop>
    <div v-if="replyTo" class="editor-reply-tip">
      正在回复 <b>@{{ replyTo.nickname }}</b>
      <i class="ri-close-circle-line" title="取消回复" @click="$emit('cancel-reply')"></i>
    </div>

    <div v-if="!store.user" class="editor-guests">
      <input v-model="guest.nickname" placeholder="昵称*" maxlength="16" />
      <input v-model="guest.email" placeholder="邮箱*" maxlength="60" />
      <input v-model="guest.website" placeholder="网站" maxlength="100" />
    </div>

    <textarea
      ref="taRef"
      v-model="content"
      :placeholder="replyTo ? `回复 @${replyTo.nickname}` : '评论'"
      @keydown.ctrl.enter="submit"
    ></textarea>

    <div v-if="usedStickers.length" class="used-stickers">
      <span class="used-label">已插入</span>
      <img
        v-for="u in usedStickers"
        :key="u.i"
        :src="u.url"
        :alt="u.name"
        title="点一下移除"
        @click="removeStickerAt(u.i)"
      />
    </div>

    <div v-if="showEmoji" ref="panelRef" class="emoji-panel">
      <div v-if="groups.length" class="emoji-tabs">
        <button type="button" :class="{ active: activeTab === 'emoji' }" @click="pickTab('emoji')">
          <span class="tab-ico">😀</span>Emoji
        </button>
        <button
          v-for="g in groups"
          :key="g.id"
          type="button"
          :class="{ active: activeTab === `g${g.id}` }"
          @click="pickTab(`g${g.id}`)"
        >
          {{ g.name }}<i class="tab-num">{{ g.stickers.length }}</i>
        </button>
      </div>

      <div v-if="activeTab === 'emoji'" class="emoji-grid">
        <span v-for="e in emojis" :key="e" @click="insertText(e)">{{ e }}</span>
      </div>

      <div v-else-if="currentStickers.length" class="sticker-grid">
        <button
          v-for="s in currentStickers"
          :key="s.id"
          type="button"
          class="sticker-item"
          :title="s.name || '表情'"
          @click="insertSticker(s)"
        >
          <img :src="s.url" :alt="s.name || '表情'" loading="lazy" />
        </button>
      </div>

      <div v-else class="emoji-empty">这个分组还没有表情</div>
    </div>

    <div class="editor-foot">
      <div class="editor-tools">
        <i
          class="ri-emotion-line"
          :style="{ color: showEmoji ? 'var(--theme)' : '' }"
          title="表情"
          @click="togglePanel"
        ></i>
        <button
          v-if="!store.user"
          type="button"
          class="editor-anon"
          title="随机填一个昵称和邮箱，不想留真名时用"
          @click="anon"
        >
          <i class="ri-eye-off-line"></i>
          <span>匿名</span>
        </button>
        <span class="editor-count" :class="{ warn: overWarn }">{{ len }}/{{ MAX }}</span>
      </div>
      <div class="editor-btns">
        <button class="btn-cancel" @click="$emit('cancel')">取消</button>
        <button class="btn-send" :disabled="submitting" @click="submit">
          {{ submitting ? '发送中…' : '发送' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { store, toast, loadStickers, saveGuestProfile } from '../store.js';
import { STICKERS_MAX, charCount } from '../utils.js';
import { randomGuest } from '../random-guest.js';

const MAX = 1000;

const props = defineProps({
  postId: { type: [Number, String], required: true },
  replyTo: { type: Object, default: null },
});
const emit = defineEmits(['done', 'cancel', 'cancel-reply']);

const content = ref('');
const showEmoji = ref(false);
const tab = ref('emoji');
const submitting = ref(false);
const taRef = ref(null);
const panelRef = ref(null);

// 按码点计数，emoji 算 1 个字；表情占位符不占额度（和后端一致）
const len = computed(() => charCount(content.value));
const stickerCount = computed(() => (content.value.match(/\[s:\d{1,9}\]/g) || []).length);
const overWarn = computed(() => len.value > MAX - 50);

/* 直接引用全局访客信息：和「信息登记」弹窗共用同一份，登记过这里就自动填好 */
const guest = store.guest;

/* 匿名：一键填随机昵称 + 邮箱，和信息登记里的「随便起一个」用同一套池子。
   点一次换一个；填完照样能手动改，提交时才写进本地存储。
   提示只在第一次点的时候给：连点几下换名字时，输入框里的变化已经够明显了。 */
const anonHinted = ref(false);

function anon() {
  const r = randomGuest(guest.nickname);
  guest.nickname = r.nickname;
  guest.email = r.email;
  if (!anonHinted.value) {
    anonHinted.value = true;
    toast('已随机填好，可以直接改');
  }
}

const emojis = [
  '😀','😄','😁','😆','😅','😂','🙂','😉','😍','🥰',
  '😘','😜','🤪','🤗','🤔','🤨','😐','😴','😪','😭',
  '😤','😡','🥺','😳','🥳','😎','🤓','🤩','👍','👎',
  '👏','🙏','💪','🤝','👌','✌️','🎉','🔥','💯','❤️',
  '💔','🌹','🌙','☀️','🌈','☕','🍺','🍜','🎵','📷',
];

/* 只显示「有表情」的分组：空分组留在后台，不打扰访客 */
const groups = computed(() => (store.stickerGroups || []).filter((g) => g.stickers?.length));

const activeTab = computed(() => {
  if (tab.value === 'emoji') return 'emoji';
  if (groups.value.some((g) => `g${g.id}` === tab.value)) return tab.value;
  return groups.value.length ? `g${groups.value[0].id}` : 'emoji';
});

/* 打开面板时默认停在第一个表情分组，让「刚加的表情」一眼就能看到；
   用户自己点过标签之后就不再抢他的选择 */
let tabTouched = false;
function pickTab(t) {
  tab.value = t;
  tabTouched = true;
}
function ensureTab() {
  const ids = groups.value.map((g) => `g${g.id}`);
  if (tabTouched && tab.value === 'emoji') return;
  if (ids.includes(tab.value)) return;
  tab.value = ids.length && !tabTouched ? ids[0] : 'emoji';
}

const currentStickers = computed(() => {
  if (activeTab.value === 'emoji') return [];
  const id = Number(activeTab.value.slice(1));
  return groups.value.find((g) => g.id === id)?.stickers || [];
});

/* 输入框里已经用到的表情缩略图（点一下可以删掉那一个） */
const tokenList = computed(() => content.value.match(/\[s:\d{1,9}\]/g) || []);
const usedStickers = computed(() =>
  tokenList.value
    .map((t, i) => {
      const id = t.slice(3, -1);
      return { url: store.stickerMap?.[id] || '', name: store.stickerNames?.[id] || '表情', i };
    })
    .filter((x) => x.url)
);

onMounted(async () => {
  /* 访客信息在应用启动时已从本地读进 store，这里不再单独读，
     免得覆盖用户正在另一个评论框里填的内容 */
  document.addEventListener('click', closePanel);
  await nextTick();
  taRef.value?.focus();
});

onBeforeUnmount(() => document.removeEventListener('click', closePanel));

function closePanel() {
  showEmoji.value = false;
}

async function togglePanel() {
  showEmoji.value = !showEmoji.value;
  if (!showEmoji.value) return;
  if (!store.stickersLoaded) await loadStickers();
  ensureTab();
  await nextTick();
  // 面板往下展开，如果露出屏幕底部就往上滚一点，别让表情被挡住
  const el = panelRef.value;
  if (el) {
    const rect = el.getBoundingClientRect();
    const over = rect.bottom - (window.innerHeight - 12);
    if (over > 0) window.scrollBy({ top: over, behavior: 'smooth' });
  }
}

/** 点缩略图移除第 index 个表情 */
function removeStickerAt(index) {
  let seen = -1;
  content.value = content.value.replace(/\[s:\d{1,9}\]/g, (m) => {
    seen += 1;
    return seen === index ? '' : m;
  });
}

/** 在光标处插入：表情插到中间也符合预期 */
function insertText(str) {
  const ta = taRef.value;
  if (!ta) {
    content.value += str;
    return;
  }
  const start = ta.selectionStart ?? content.value.length;
  const end = ta.selectionEnd ?? start;
  content.value = content.value.slice(0, start) + str + content.value.slice(end);
  nextTick(() => {
    ta.focus();
    const pos = start + str.length;
    ta.setSelectionRange(pos, pos);
  });
}

function insertSticker(s) {
  if (stickerCount.value >= STICKERS_MAX) {
    return toast(`一条评论最多用 ${STICKERS_MAX} 个表情`, 'error');
  }
  insertText(`[s:${s.id}]`);
}

async function submit() {
  const text = content.value.trim();
  if (!text) return toast('请输入评论内容', 'error');
  if (len.value > MAX) return toast(`评论最多 ${MAX} 字`, 'error');
  if (stickerCount.value > STICKERS_MAX) {
    return toast(`一条评论最多用 ${STICKERS_MAX} 个表情`, 'error');
  }
  if (/<\s*\/?\s*[a-z!]/i.test(text) || /\bon[a-z]{3,}\s*=/i.test(text) || /javascript\s*:/i.test(text)) {
    return toast('评论里不能包含 HTML 或脚本代码', 'error');
  }
  if (!store.user) {
    const nick = guest.nickname.trim();
    if (!nick) return toast('请填写昵称', 'error');
    if (/[<>]/.test(nick)) return toast('昵称不能包含 < > 符号', 'error');
    if ([...nick].length > 16) return toast('昵称最多 16 字', 'error');
    const mail = guest.email.trim();
    if (!mail) return toast('请填写邮箱', 'error');
    if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(mail)) {
      return toast('请填写正确的邮箱', 'error');
    }
    const site = guest.website.trim();
    if (site && /^[a-z][a-z0-9+.-]*:/i.test(site) && !/^https?:/i.test(site)) {
      return toast('网站只支持 http / https 链接', 'error');
    }
    saveGuestProfile();
  }
  submitting.value = true;
  try {
    const data = await api.post(`/api/posts/${props.postId}/comments`, {
      content: text,
      parent_id: props.replyTo ? props.replyTo.id : 0,
      nickname: guest.nickname,
      email: guest.email,
      website: guest.website,
    });
    toast(data.message || '评论成功');
    if (!store.user) {
      /* 评论框填的昵称和「信息登记」是同一份，顺手把之前点过的赞也补上名字 */
      api.post('/api/guest/profile', { nickname: guest.nickname.trim() }).catch(() => {});
    }
    content.value = '';
    showEmoji.value = false;
    emit('done', data.comments || []);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.editor-count {
  font-size: 11px;
  color: var(--texths);
  font-variant-numeric: tabular-nums;
}
.editor-count.warn {
  color: #e6a23c;
}
</style>
