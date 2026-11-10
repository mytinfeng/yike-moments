/* 随机访客身份：给不愿意留真名、但又得留个称呼的人一条捷径。
   「信息登记」弹窗和评论框的「匿名」按钮共用这一份，两处永远一致。

   名字都控制在 16 字以内、不含敏感词、没有连续重复字符，
   和服务端 checkNickname 的规则对齐，点完直接能提交。 */
export const NICK_POOL = [
  '路过的风',
  '晚风不识字',
  '看云的猫',
  '檐下听雨',
  '月亮邮差',
  '山间来客',
  '借我半盏茶',
  '楼下的树',
  '一只咸鱼',
  '已读不回',
  '三分钟热度',
  '深夜食堂常客',
  '假装路过',
  '偶尔来坐坐',
  '只看不说话',
  '潜水选手',
  '路过人间',
  '无声观众',
  '不署名的读者',
  '隔壁的灯',
];

/* 随机邮箱用当前域名做后缀，看起来像真的。localhost、内网名、纯 IP 这些
   不合法的「域名」要退回去：服务端要求最后一段至少两个字母（见 guard.js
   的 checkEmail），localhost 直接被判成「邮箱域名不完整」。 */
export const MAIL_DOMAIN = (() => {
  const host = String(location.hostname || '')
    .toLowerCase()
    .replace(/^www\./, '');
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(host)) return host;
  return 'pyq.local';
})();

export function randomMail() {
  /* 5 位随机码：36^5 ≈ 6000 万种，够用；再长邮箱框在手机上就装不下了 */
  const code = Math.random().toString(36).slice(2, 7).padEnd(5, '0');
  return `guest${code}@${MAIL_DOMAIN}`;
}

/* 排除当前值：连着点两下一定换一个，不会出现「点半天还是这个名字」 */
export function randomName(current = '') {
  const pool = NICK_POOL.filter((n) => n !== current);
  return pool[Math.floor(Math.random() * pool.length)] || NICK_POOL[0];
}

/** 一次拿到昵称 + 邮箱（不含网站，那是可选字段，不动用户已填的） */
export function randomGuest(current = '') {
  return { nickname: randomName(current), email: randomMail() };
}
