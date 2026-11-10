<template>
  <div class="centent">
    <div class="kehua-main">
      <div class="write-head">
        <button class="head-back" @click="cancel"><i class="ri-arrow-left-line"></i></button>
        <span class="title">{{ editId ? '编辑动态' : '发表动态' }}</span>
        <div class="actions">
          <button class="btn-primary" style="width: auto; height: 34px; padding: 0 18px" :disabled="submitting" @click="submit">
            {{ submitting ? '发布中…' : editId ? '保存' : '发表' }}
          </button>
        </div>
      </div>

      <div v-if="!store.user" class="not-logged">
        <i class="ri-user-3-line"></i>
        发布动态需要先登录
        <div style="margin-top: 16px">
          <button class="btn-primary" style="width: 180px" @click="store.loginOpen = true">去登录</button>
        </div>
      </div>

      <template v-else>
        <div class="write-author">
          <img :src="store.user.avatar || store.settings.avatar" alt="" />
          <strong>{{ store.user.nickname }}</strong>
        </div>

        <div class="write-body">
          <textarea
            v-model="content"
            placeholder="这一刻的想法…（可直接粘贴截图）"
            maxlength="2000"
            @input="autoGrow"
            ref="taRef"
          ></textarea>
        </div>

        <div v-if="images.length" class="write-grid">
          <div v-for="(img, i) in images" :key="img + i" class="write-thumb">
            <img v-lazy="img" alt="" />
            <span class="remove" @click="images.splice(i, 1)"><i class="ri-close-line"></i></span>
          </div>
          <div v-if="images.length < 9" class="write-add" @click="pickFiles">
            <i :class="uploading ? 'ri-loader-4-line spinning' : 'ri-add-line'"></i>
          </div>
        </div>
        <div v-else class="write-grid">
          <div class="write-add" @click="pickFiles">
            <i :class="uploading ? 'ri-loader-4-line spinning' : 'ri-add-line'"></i>
          </div>
        </div>
        <!-- 媒体库入口放在网格外面：网格是固定 3 列，多塞一格会掉到第二行，很难看 -->
        <p
          v-if="isAdmin && images.length < 9"
          class="write-lib-link"
          title="复用已经上传过的图片，不用重新传"
          @click="openLib('images')"
        >
          <i class="ri-folder-image-line"></i>从媒体库选图片
        </p>

        <div class="write-extras" style="margin-top: 8px">
          <div class="write-field">
            <i class="ri-map-pin-line"></i>
            <input
              v-model="location"
              placeholder="所在位置（选填，默认按 IP 定位到城市）"
              maxlength="40"
              @input="onLocationInput"
            />
            <button
              class="write-field-btn"
              :disabled="locating"
              :title="locating ? '正在定位…' : '按 IP 重新定位'"
              @click="autoLocate(true)"
            >
              <i :class="locating ? 'ri-loader-4-line spinning' : 'ri-focus-3-line'"></i>
            </button>
            <button v-if="location" class="write-field-btn" title="清空位置" @click="clearLocation">
              <i class="ri-close-line"></i>
            </button>
          </div>
          <p v-if="locateHint" class="write-locate-tip">{{ locateHint }}</p>
          <div v-if="isAdmin" class="write-field">
            <i class="ri-link"></i>
            <input v-model="adUrl" placeholder="广告外链（选填，形如 https://…）" maxlength="200" />
          </div>
        </div>

        <div v-if="video" class="write-video-box">
          <video :src="video" controls playsinline></video>
          <span class="remove" @click="video = ''"><i class="ri-close-line"></i></span>
        </div>

        <div v-if="showMusic" class="write-music-panel">
          <h4>添加音乐</h4>
          <div class="write-music-row">
            <input v-model="music.title" placeholder="歌曲名" maxlength="40" />
            <input v-model="music.artist" placeholder="歌手" maxlength="40" />
          </div>
          <div class="write-music-row">
            <input v-model="music.url" placeholder="音频直链 https://…mp3" maxlength="300" />
            <button
              v-if="isAdmin"
              class="btn-ghost"
              style="flex-shrink: 0; padding: 0 10px"
              title="从媒体库选音频"
              @click="openLib('music_url')"
            >
              <i class="ri-folder-music-line"></i>
            </button>
          </div>
          <div class="write-music-row">
            <input v-model="music.cover" placeholder="封面图地址（选填）" maxlength="300" />
            <button
              v-if="isAdmin"
              class="btn-ghost"
              style="flex-shrink: 0; padding: 0 10px"
              title="从媒体库选封面图"
              @click="openLib('music_cover')"
            >
              <i class="ri-folder-image-line"></i>
            </button>
            <button class="btn-ghost" style="flex-shrink: 0" @click="pickAudio">上传音频</button>
          </div>
          <p class="write-tip" style="padding: 0">支持 mp3 / m4a 直链，或直接上传本地音频文件。</p>
        </div>

        <div v-if="showLink" class="write-music-panel write-link-panel">
          <h4>添加网页卡片</h4>
          <div class="write-music-row">
            <input
              v-model="linkInput"
              placeholder="粘贴网页链接，如 https://example.com"
              maxlength="500"
              @keyup.enter="fetchLink"
            />
            <button class="btn-ghost" style="flex-shrink: 0" :disabled="linkLoading" @click="fetchLink">
              {{ linkLoading ? '获取中…' : '获取信息' }}
            </button>
          </div>
          <p v-if="linkError" class="write-link-err">{{ linkError }}</p>
          <template v-if="linkCard.url">
            <LinkCard :link="linkCard" />
            <p class="write-tip" style="padding: 0">
              标题和简介抓自目标网页 ·
              <a style="color: var(--theme); cursor: pointer" @click="clearLink">移除卡片</a>
            </p>
          </template>
          <p v-else class="write-tip" style="padding: 0">
            输入网址后自动获取对方的图标、标题和描述，没有图标就显示默认的地球图标。
          </p>
        </div>

        <div class="write-extras" style="display: flex; gap: 16px">
          <template v-if="isAdmin">
            <label class="check-line"><input v-model="isPinned" type="checkbox" /> 置顶</label>
            <label class="check-line"><input v-model="isAd" type="checkbox" /> 标记为广告</label>
          </template>
          <label class="check-line" title="图片先糊住，读者点一下才显示内容">
            <input v-model="isNsfw" type="checkbox" /> 图片遮罩
          </label>
        </div>

        <div v-if="showEmoji" class="emoji-panel" style="margin: 8px 18px">
          <div class="emoji-grid">
            <span v-for="e in emojis" :key="e" @click="content += e">{{ e }}</span>
          </div>
        </div>

        <div class="write-tools">
          <div class="left">
            <i class="ri-image-add-line" title="添加图片（也可直接粘贴）" @click="pickFiles"></i>
            <i class="ri-video-add-line" title="添加视频" @click="pickVideo" :style="video ? 'color:var(--theme)' : ''"></i>
            <i
              v-if="isAdmin"
              class="ri-folder-video-line"
              title="从媒体库选视频"
              @click="openLib('video')"
            ></i>
            <i class="ri-music-2-line" title="添加音乐" @click="showMusic = !showMusic"></i>
            <i
              class="ri-link"
              title="添加网页卡片"
              :style="linkCard.url ? 'color:var(--theme)' : ''"
              @click="showLink = !showLink"
            ></i>
            <i class="ri-emotion-line" title="表情" @click="showEmoji = !showEmoji"></i>
          </div>
          <span class="editor-count">{{ content.length }}/2000</span>
        </div>

        <p class="write-tip">图片可以直接 Ctrl+V 粘贴上传；发布后会立即出现在首页，可在后台随时编辑或删除。</p>
      </template>

      <input ref="fileRef" type="file" accept="image/*" multiple hidden @change="onFiles" />
      <input ref="videoRef" type="file" accept="video/*" hidden @change="onVideo" />
      <input ref="audioRef" type="file" accept="audio/*" hidden @change="onAudio" />
    </div>

    <MediaPicker
      v-model:open="libOpen"
      :type="libCfg.type"
      :title="libCfg.title"
      :multiple="libCfg.multiple"
      :max="libCfg.max"
      :exclude="libCfg.exclude"
      @select="onLibPick"
    />
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { store, toast } from '../store.js';
import { compressImage } from '../utils.js';
import LinkCard from '../components/LinkCard.vue';
import MediaPicker from '../components/MediaPicker.vue';

const route = useRoute();
const router = useRouter();

const content = ref('');
const images = ref([]);
const video = ref('');
const location = ref('');
const adUrl = ref('');
const isPinned = ref(false);
const isAd = ref(false);
/* 图片遮罩：发布后图片默认模糊，读者点一下才露出来 */
const isNsfw = ref(false);
const showMusic = ref(false);
const showEmoji = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const fileRef = ref(null);
const videoRef = ref(null);
const audioRef = ref(null);
const taRef = ref(null);
const music = reactive({ title: '', artist: '', url: '', cover: '' });

/* 媒体库选择：管理员的媒体库里已经有传过的图，直接复用，不用重传 */
const libOpen = ref(false);
const libCfg = reactive({
  target: '',
  type: 'image',
  title: '选择图片',
  multiple: false,
  max: 0,
  exclude: [],
});

function openLib(target) {
  libCfg.target = target;
  libCfg.exclude = [];
  libCfg.multiple = false;
  libCfg.max = 0;
  if (target === 'images') {
    const room = 9 - images.value.length;
    if (room <= 0) {
      toast('一条动态最多 9 张图片', 'error');
      return;
    }
    Object.assign(libCfg, {
      type: 'image',
      title: '从媒体库选图片',
      multiple: true,
      max: room,
      exclude: images.value,
    });
  } else if (target === 'video') {
    Object.assign(libCfg, { type: 'video', title: '从媒体库选视频' });
  } else if (target === 'music_url') {
    Object.assign(libCfg, { type: 'audio', title: '从媒体库选音频' });
  } else if (target === 'music_cover') {
    Object.assign(libCfg, { type: 'image', title: '选择音乐封面' });
  }
  libOpen.value = true;
}

function onLibPick(urls) {
  if (!urls?.length) return;
  const one = urls[0];
  switch (libCfg.target) {
    case 'images': {
      const room = 9 - images.value.length;
      if (room <= 0) return;
      const take = urls.slice(0, room);
      images.value.push(...take);
      toast(`已添加 ${take.length} 张`);
      break;
    }
    case 'video':
      video.value = one;
      toast('已选用视频');
      break;
    case 'music_url':
      music.url = one;
      if (!music.title) {
        music.title = decodeURIComponent(one.split('/').pop().replace(/\.[^.]+$/, ''));
      }
      toast('已选用音频');
      break;
    case 'music_cover':
      music.cover = one;
      toast('已选用封面');
      break;
    default:
      break;
  }
}

/* 网页卡片：抓回来的标题 / 简介 / 图标 */
const showLink = ref(false);
const linkInput = ref('');
const linkLoading = ref(false);
const linkError = ref('');
const linkCard = reactive({ url: '', host: '', title: '', desc: '', icon: '' });

async function fetchLink() {
  const url = linkInput.value.trim();
  linkError.value = '';
  if (!url) {
    linkError.value = '先粘贴一个网页链接';
    return;
  }
  linkLoading.value = true;
  try {
    const data = await api.get(`/api/link/preview?url=${encodeURIComponent(url)}`);
    Object.assign(linkCard, {
      url: data.url,
      host: data.host || '',
      title: data.title || '',
      desc: data.desc || '',
      icon: data.icon || '',
    });
    linkInput.value = data.url;
    if (!data.title) linkError.value = '没抓到标题，已用域名代替';
  } catch (e) {
    linkError.value = e.message || '获取失败';
  } finally {
    linkLoading.value = false;
  }
}

function clearLink() {
  Object.assign(linkCard, { url: '', host: '', title: '', desc: '', icon: '' });
  linkInput.value = '';
  linkError.value = '';
}

/* 定位：默认按 IP 带到市级，用户随时可以改 */
const locating = ref(false);
const locateHint = ref('');
const locationDirty = ref(false);

const editId = computed(() => route.query.edit || '');
const isAdmin = computed(() => store.user?.role === 'admin');

const emojis = [
  '😀','😄','😁','😆','😅','😂','🙂','😉','😍','🥰',
  '😘','😜','🤪','🤗','🤔','😐','😴','😭','😤','😡',
  '🥺','😳','🥳','😎','🤓','🤩','👍','👏','🙏','💪',
  '✌️','🎉','🔥','💯','❤️','💔','🌹','🌙','☀️','🌈',
  '☕','🍺','🍜','🎵','📷','✈️','🏔️','🌊','🍃','⭐',
];

onMounted(async () => {
  /* 粘贴监听挂在整个发布页上：焦点在输入框里还是页面空白处都能用 */
  document.addEventListener('paste', onPaste);
  if (editId.value) {
    try {
      const p = await api.get(`/api/posts/${editId.value}`);
      content.value = p.content || '';
      images.value = p.images || [];
      video.value = p.video || '';
      location.value = p.location || '';
      adUrl.value = p.ad_url || '';
      isPinned.value = !!p.is_pinned;
      isAd.value = !!p.is_ad;
      isNsfw.value = !!p.nsfw;
      if (p.music) {
        Object.assign(music, p.music);
        showMusic.value = true;
      }
      if (p.link && p.link.url) {
        Object.assign(linkCard, {
          url: p.link.url,
          host: p.link.host || '',
          title: p.link.title || '',
          desc: p.link.desc || '',
          icon: p.link.icon || '',
        });
        linkInput.value = p.link.url;
        showLink.value = true;
      }
    } catch (e) {
      toast(e.message, 'error');
    }
    return;
  }
  // 新建动态：默认按 IP 定位到市级
  autoLocate();
});

/* ---------- 位置：IP 自动定位（市级） ---------- */
async function autoLocate(manual = false) {
  if (locating.value) return;
  if (!store.user) return;
  locating.value = true;
  locateHint.value = '正在根据 IP 定位所在城市…';
  const before = location.value;
  try {
    const data = await api.get('/api/geo/locate');
    if (!manual && locationDirty.value) {
      // 定位返回前用户已经自己填了，别覆盖
      locateHint.value = '';
      return;
    }
    if (data.city) {
      location.value = data.city;
      locateHint.value = `已按 IP 定位到「${data.city}」，可直接改成别的城市`;
    } else {
      location.value = manual ? before : location.value;
      locateHint.value = '没能自动识别所在城市，手动填一个就好';
    }
  } catch {
    locateHint.value = '自动定位失败，手动填一个就好';
  } finally {
    locating.value = false;
  }
}

function onLocationInput() {
  locationDirty.value = true;
  locateHint.value = '';
}

// 未登录时打开发布页不会定位，登录成功后补一次
watch(
  () => store.user?.id,
  (id) => {
    if (id && !editId.value && !location.value && !locationDirty.value) autoLocate();
  }
);

function clearLocation() {
  location.value = '';
  locationDirty.value = true;
  locateHint.value = '已清空位置，这条动态不会显示定位';
}

function pickFiles() {
  fileRef.value?.click();
}
function pickAudio() {
  audioRef.value?.click();
}
function pickVideo() {
  videoRef.value?.click();
}
function autoGrow() {
  const ta = taRef.value;
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(420, ta.scrollHeight)}px`;
}

async function onFiles(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = '';
  if (!files.length) return;
  await uploadImages(files);
}

/**
 * 上传图片：统一走这里（选文件 / 粘贴 两条路都一样）
 * 超出 9 张的部分自动截断，而不是整批拒掉
 */
async function uploadImages(files) {
  if (!files.length) return 0;
  if (!store.user) {
    toast('登录后才能上传图片', 'error');
    return 0;
  }
  if (uploading.value) {
    toast('还在上传，稍等一下', 'error');
    return 0;
  }
  const room = 9 - images.value.length;
  if (room <= 0) {
    toast('一条动态最多 9 张图片', 'error');
    return 0;
  }
  let list = files;
  if (list.length > room) {
    toast(`一条最多 9 张，多出的 ${list.length - room} 张已跳过`, 'error');
    list = list.slice(0, room);
  }

  uploading.value = true;
  autoGrow();
  let added = 0;
  try {
    // 接口单次最多收 9 个，按批传
    for (let i = 0; i < list.length; i += 9) {
      const chunk = list.slice(i, i + 9);
      const prepared = await Promise.all(chunk.map((f) => compressImage(f).catch(() => f)));
      const data = await api.upload(prepared);
      images.value.push(...(data.files || []).map((f) => f.url));
      added += data.files?.length || 0;
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    uploading.value = false;
  }
  return added;
}

/** 粘贴上传：从剪贴板里捞出图片文件（截图、复制的图片都走这条路） */
function onPaste(e) {
  if (!store.user) return;
  const dt = e.clipboardData;
  if (!dt) return;
  const files = [];
  for (const item of dt.items || []) {
    if (item.kind !== 'file' || !String(item.type || '').startsWith('image/')) continue;
    const f = item.getAsFile();
    if (f) files.push(f);
  }
  if (!files.length) return;
  /* 剪贴板里同时带文字时不拦默认行为，否则文本会被一起吞掉 */
  const hasText = !!(dt.getData('text/plain') || dt.getData('text/html'));
  if (!hasText) e.preventDefault();
  uploadImages(files).then((n) => {
    if (n) toast(`已粘贴上传 ${n} 张图片`);
  });
}

async function onVideo(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = await api.upload([file]);
    video.value = data.files[0].url;
    toast('视频已上传');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    e.target.value = '';
  }
}

async function onAudio(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const data = await api.upload([file]);
    music.url = data.files[0].url;
    if (!music.title) music.title = file.name.replace(/\.[^.]+$/, '');
    showMusic.value = true;
    toast('音频已上传');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    e.target.value = '';
  }
}

async function submit() {
  if (!content.value.trim() && !images.value.length && !music.url && !video.value && !linkCard.url) {
    return toast('写点什么或选张图片吧', 'error');
  }
  submitting.value = true;
  const payload = {
    content: content.value,
    images: images.value,
    video: video.value,
    location: location.value,
    ad_url: adUrl.value,
    music: music.url ? { ...music } : null,
    link: linkCard.url ? { ...linkCard } : null,
    is_pinned: isPinned.value,
    is_ad: isAd.value,
    nsfw: isNsfw.value,
  };
  try {
    if (editId.value) {
      await api.put(`/api/posts/${editId.value}`, payload);
      toast('已保存');
      router.push(`/post/${editId.value}`);
    } else {
      const post = await api.post('/api/posts', payload);
      toast('发表成功');
      router.push('/');
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    submitting.value = false;
  }
}

onBeforeUnmount(() => document.removeEventListener('paste', onPaste));

function cancel() {
  router.back();
}
</script>

<style scoped>
.check-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--textqh);
  cursor: pointer;
  padding: 6px 0;
}
.check-line input {
  width: 15px;
  height: 15px;
  -webkit-appearance: checkbox;
  appearance: auto;
  accent-color: var(--theme);
  flex-shrink: 0;
}
.editor-count {
  font-size: 11px;
  color: var(--texths);
}
.write-link-panel .link-card {
  width: 100%;
  margin: 8px 0 6px;
}
.write-link-err {
  font-size: 12px;
  color: #e74c3c;
  padding: 0;
  margin-bottom: 6px;
}
</style>
