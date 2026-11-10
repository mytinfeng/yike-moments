import { reactive } from 'vue';
import { api, getToken, setToken } from './api.js';

export const store = reactive({
  user: null,
  settings: {
    site_name: '壹刻',
    site_desc: '',
    seo_title: '',
    seo_description: '',
    seo_keywords: '',
    avatar: '',
    cover_type: 'image',
    cover_image: '',
    cover_video: '',
    cover_images: [],
    theme_color: '#09c362',
    page_size: 8,
    night_auto: '1',
    allow_register: '1',
    footer_text: '',
    bg_music: [],
    show_music_player: '1',
    cover_welcome: '欢迎光临{site}的朋友圈',
    cover_visit: '{count}位朋友到访过~',
    cover_lines: '',
  },
  ready: false,
  themeDark: false,
  toasts: [],
  loginOpen: false,
  searchOpen: false,
  linksOpen: false,
  lightbox: { open: false, images: [], index: 0 },
  confirm: { open: false, message: '', title: '确认操作', okText: '确定', danger: true },
  player: {
    track: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    visible: false,
  },
  playerApi: null,
  unread: 0,
  /* 访客信息（未登录用户）：昵称 / 邮箱 / 网站。「信息登记」弹窗写这里，
     评论框直接读同一份，所以两处永远是同步的 */
  guest: { nickname: '', email: '', website: '' },
  guestOpen: false,
  /* 表情包：groups = 前台可见分组（带表情列表，供选择面板用），
     map = id → 图片地址，stickerNames = id → 名称（自定义名 / 文件名），都供渲染用 */
  stickerGroups: [],
  stickerMap: {},
  stickerNames: {},
  stickersLoaded: false,
  /* 累计到访人数（按访客去重），首页封面左下角显示；0 表示还没拿到或接口失败 */
  visitCount: 0,
});

let toastSeq = 0;
export function toast(message, type = 'success') {
  const id = ++toastSeq;
  store.toasts.push({ id, message, type });
  setTimeout(() => {
    const i = store.toasts.findIndex((t) => t.id === id);
    if (i > -1) store.toasts.splice(i, 1);
  }, 2600);
}

/* ---------- 主题 ---------- */
export function isDark() {
  return document.documentElement.classList.contains('dark-theme');
}
export function applyTheme(dark) {
  document.documentElement.classList.toggle('dark-theme', dark);
  localStorage.setItem('pyq_theme_manual', dark ? 'dark' : 'light');
  store.themeDark = dark;
}
export function toggleTheme() {
  applyTheme(!isDark());
}

/* ---------- favicon 跟随站点头像 ---------- */
const FAVICON_FALLBACK = '/uploads/seed/avatar-main.jpg';
export function applyFavicon(url) {
  const href = String(url || '').trim() || FAVICON_FALLBACK;
  document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((el) => {
    if (el.getAttribute('href') !== href) el.setAttribute('href', href);
  });
}

/* ---------- 访客信息（信息登记） ---------- */
const GUEST_KEY = 'pyq_guest';

/** 从本地读回上次登记的昵称 / 邮箱 / 网站。
 *  注意用 Object.assign 就地更新：store.guest 这个对象被评论框直接持有，
 *  整体替换会让组件里的引用指向旧对象，出现「登记完评论框还是空的」。 */
export function loadGuestProfile() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(GUEST_KEY) || '{}') || {};
  } catch {}
  Object.assign(store.guest, {
    nickname: String(saved.nickname || ''),
    email: String(saved.email || ''),
    website: String(saved.website || ''),
  });
  return store.guest;
}

/** 保存访客信息：评论框和「信息登记」都走这里，保证存的是同一份 */
export function saveGuestProfile(patch = {}) {
  Object.assign(store.guest, patch);
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(store.guest));
  } catch {}
  return store.guest;
}

/** 点赞时要带给服务端的展示昵称（登录用户用账号昵称，服务端会忽略这个值） */
export function guestNickname() {
  return store.user ? '' : String(store.guest.nickname || '').trim();
}

/* ---------- 友站动态：访客级「不看」偏好 ----------
   cookie 里存的是「被屏蔽的站点 id 列表」，不是一个布尔值。
   现在的界面是点哪个站就屏蔽哪个站；将来要做「一键全关」，也不用改数据格式。 */
const MUTE_COOKIE = 'pyq_mute_friends';
const MUTE_DAYS = 7;

export function readMutedSites() {
  try {
    const m = String(document.cookie || '').match(/(?:^|;\s*)pyq_mute_friends=([^;]*)/);
    if (!m) return [];
    return decodeURIComponent(m[1])
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 屏蔽一个站点，返回最新列表 */
export function muteFriendSite(id) {
  const list = readMutedSites();
  if (id && !list.includes(id)) list.push(id);
  document.cookie = `${MUTE_COOKIE}=${encodeURIComponent(list.join(','))}; Path=/; Max-Age=${
    MUTE_DAYS * 86400
  }; SameSite=Lax`;
  return list;
}

/** 「恢复显示」：整条清掉 */
export function unmuteFriendSites() {
  document.cookie = `${MUTE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/* ---------- 访问量 ----------
   首页挂载时上报一次，服务端按 cookie 里的 pyq_guest 去重，所以同一个人
   反复刷新也只算一位。离线、接口挂了都静默忽略：文案不显示就是了，
   不能因为它失败给访客弹报错。

   用 promise 缓存：封面和首页都会调，两边共用一个请求，不会重复上报。 */
let visitPromise = null;
export function loadVisits() {
  if (visitPromise) return visitPromise;
  visitPromise = api
    .post('/api/visit')
    .then((data) => {
      store.visitCount = Number(data?.count) || 0;
    })
    .catch(() => {})
    .then(() => {
      visitPromise = null;
    });
  return visitPromise;
}

/* ---------- 表情包 ---------- */
export async function loadStickers() {
  try {
    const data = await api.get('/api/stickers');
    store.stickerGroups = Array.isArray(data?.groups) ? data.groups : [];
    store.stickerMap = data?.map || {};
    store.stickerNames = data?.names || {};
    store.stickersLoaded = true;
  } catch (e) {
    console.warn('加载表情包失败', e);
  }
  return store.stickerGroups;
}

/* ---------- 初始化 ---------- */
export async function bootstrap() {
  loadGuestProfile();
  try {
    const s = await api.get('/api/settings');
    store.settings = { ...store.settings, ...s };
    /* 首屏 TDK 已由服务端注入 HTML，这里同步是为了：
       后台改完设置立刻生效、前端切路由时标题不留在旧值上 */
    document.title = s.seo_title || s.site_name || '壹刻';
    const desc = s.seo_description || s.site_desc;
    const descEl = document.querySelector('meta[name="description"]');
    if (descEl && desc) descEl.setAttribute('content', desc);
    const kwEl = document.querySelector('meta[name="keywords"]');
    if (kwEl && s.seo_keywords) kwEl.setAttribute('content', s.seo_keywords);
    if (s.theme_color) document.documentElement.style.setProperty('--theme', s.theme_color);
  } catch (e) {
    console.warn('加载站点设置失败', e);
  }
  // favicon 跟站点头像走（头像没设就用内置默认图）
  applyFavicon(store.settings.avatar);
  if (getToken()) {
    try {
      const { user } = await api.get('/api/auth/me');
      store.user = user;
    } catch {
      setToken('');
      store.user = null;
    }
  }
  await loadStickers();
  store.ready = true;
  store.themeDark = document.documentElement.classList.contains('dark-theme');
  // 站点背景音乐：默认不显示播放器，等用户点了音乐按钮再出现（也就不自动播放）
}

export async function login(username, password) {
  const data = await api.post('/api/auth/login', { username, password });
  setToken(data.token);
  store.user = data.user;
  return data.user;
}

export async function register(payload) {
  const data = await api.post('/api/auth/register', payload);
  setToken(data.token);
  store.user = data.user;
  return data.user;
}

export async function logout() {
  try {
    await api.post('/api/auth/logout');
  } catch {}
  setToken('');
  store.user = null;
}

export function playTrack(track) {
  if (!track || !track.url) return;
  if (store.player.track && store.player.track.url === track.url) {
    store.playerApi?.toggle();
    return;
  }
  store.player.track = track;
  store.player.visible = true;
  store.playerApi?.load(track);
}

/* ---------- 站点背景音乐 ---------- */
export const hasBgMusic = () =>
  store.settings.show_music_player === '1' &&
  Array.isArray(store.settings.bg_music) &&
  store.settings.bg_music.length > 0;

/** 点音乐按钮：没播放过就从头播，播放中则暂停/继续；播放器随之显隐 */
export function toggleBgMusic() {
  const list = Array.isArray(store.settings.bg_music) ? store.settings.bg_music : [];
  if (store.settings.show_music_player !== '1' || !list.length) return;
  if (!store.player.track || !store.player.track.url) {
    store.player.track = list[0];
    store.player.visible = true;
    store.playerApi?.load(list[0]);
    return;
  }
  store.player.visible = true;
  store.playerApi?.toggle();
}

export function openLightbox(images, index = 0) {
  store.lightbox = { open: true, images, index };
}

let confirmResolver = null;
export function confirmDialog(message, options = {}) {
  store.confirm = {
    open: true,
    message,
    title: options.title || '确认操作',
    okText: options.okText || '确定',
    danger: options.danger !== false,
  };
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}
export function resolveConfirm(value) {
  store.confirm.open = false;
  if (confirmResolver) confirmResolver(value);
  confirmResolver = null;
}
