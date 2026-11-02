/**
 * IP 归属地（仅精确到市级）
 *
 * 目的：发布动态时默认按访客 IP 自动带出所在城市，用户仍可随意改写。
 * 数据源按顺序降级，任何一个失败都继续试下一个；全部失败就返回空城市，不阻塞发布。
 *   1. 太平洋电脑网 whois（国内城市中文名最准，GBK 编码，免费无 key）
 *   2. ip-api.com（http 免费，支持中文参数）
 *   3. ipapi.co（https，城市名为英文，兜底）
 *
 * 结果在内存里缓存 6 小时（失败缓存 5 分钟），避免每次打开发布页都请求外网。
 */

const CACHE_TTL = 6 * 60 * 60 * 1000;
const FAIL_TTL = 5 * 60 * 1000;
const CACHE_MAX = 500;
const TIMEOUT = 4000;
const SELF_KEY = '__self__';

const cache = new Map();

/* ---------------- IP 处理 ---------------- */

export function normalizeIp(raw) {
  let ip = String(raw || '').split(',')[0].trim();
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') ip = '127.0.0.1';
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  // 去掉 IPv6 的 zone / 端口
  ip = ip.split('%')[0];
  return ip;
}

export function isLocalIp(ip) {
  if (!ip) return true;
  if (ip === '127.0.0.1' || ip === 'localhost') return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^169\.254\./.test(ip)) return true;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
  if (/^(fc|fd|fe80)/i.test(ip)) return true;
  return false;
}

/**
 * 取真实客户端 IP。
 * 直连时用 socket 地址；经过本机 / 内网反向代理时，从 X-Forwarded-For 右往左找第一个公网地址
 * （最靠近服务器的那一跳是可信代理写入的，能挡住最常见的伪造）。
 */
export function clientIp(req) {
  const sock = normalizeIp(req.socket?.remoteAddress || '');
  if (sock && !isLocalIp(sock)) return sock;

  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((s) => normalizeIp(s))
    .filter(Boolean);
  const real = String(req.headers['x-real-ip'] || '').trim();
  if (real) chain.push(normalizeIp(real));

  for (let i = chain.length - 1; i >= 0; i -= 1) {
    if (!isLocalIp(chain[i])) return chain[i];
  }
  return sock || chain[0] || '';
}

/* ---------------- 数据源 ---------------- */

async function get(url, { encoding = 'utf-8' } = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: '*/*',
    },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let text;
  if (encoding === 'gbk') {
    try {
      text = new TextDecoder('gbk').decode(buf);
    } catch {
      text = buf.toString('utf8');
    }
  } else {
    text = buf.toString('utf8');
  }
  return text;
}

function pickJson(text) {
  const s = String(text || '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('响应不是 JSON');
  return JSON.parse(s.slice(a, b + 1));
}

/* 太平洋电脑网：{ ip, pro: '广东省', city: '深圳市', addr } */
async function fromPconline(ip) {
  if (ip && ip.includes(':')) throw new Error('仅支持 IPv4');
  const url = `https://whois.pconline.com.cn/ipJson.jsp?json=true${ip ? `&ip=${encodeURIComponent(ip)}` : ''}`;
  const data = pickJson(await get(url, { encoding: 'gbk' }));
  if (data.err) throw new Error(data.err);
  return {
    city: tidy(data.city),
    region: tidy(data.pro),
    country: tidy(data.pro) ? '中国' : '',
    ip: tidy(data.ip) || ip,
    source: 'pconline',
  };
}

/* ip-api.com：{ status, country, regionName, city } */
async function fromIpApi(ip) {
  const url = `http://ip-api.com/json/${encodeURIComponent(ip || '')}?lang=zh-CN&fields=status,message,country,regionName,city`;
  const data = pickJson(await get(url));
  if (data.status !== 'success') throw new Error(data.message || '查询失败');
  return {
    city: tidy(data.city),
    region: tidy(data.regionName),
    country: tidy(data.country),
    ip,
    source: 'ip-api',
  };
}

/* ipapi.co：{ city, region, country_name } */
async function fromIpapiCo(ip) {
  const url = `https://ipapi.co/${ip ? `${encodeURIComponent(ip)}/` : ''}json/`;
  const data = pickJson(await get(url));
  if (data.error) throw new Error(data.reason || '查询失败');
  return {
    city: tidy(data.city),
    region: tidy(data.region),
    country: tidy(data.country_name),
    ip: tidy(data.ip) || ip,
    source: 'ipapi.co',
  };
}

const SOURCES = [fromPconline, fromIpApi, fromIpapiCo];

/* ---------------- 结果整形 ---------------- */

function tidy(name) {
  return String(name || '')
    .replace(/\s+/g, '')
    .replace(/^中华人民共和国/, '中国')
    .trim();
}

/* 只留到市级：区县、街道一律丢掉；没有市级名就退到省级 */
function cityOf(city, region, country) {
  const drop = /^(市辖区|县|省直辖县级行政区划|直辖县|unknown)$/i;
  let name = '';
  if (city && !drop.test(city)) name = city;
  else if (region && !drop.test(region)) name = region;
  else name = country || '';
  // 数据源偶尔只给“上海”“济南”，中国城市统一补上“市”字
  if (name && country === '中国' && !/(市|州|盟|地区|县|区|旗)$/.test(name) && name.length <= 8) {
    name = `${name}市`;
  }
  return name;
}

function shape(raw, ip, local) {
  const city = cityOf(raw.city, raw.region, raw.country);
  const region = raw.region || '';
  // 省级与市级重名（北京 / 上海 / 天津 / 重庆）时不再重复展示
  const province = region && region !== city && !(city && region.startsWith(city.replace(/市$/, ''))) ? region : '';
  return {
    city,
    province,
    country: raw.country || '',
    ip: raw.ip || ip || '',
    source: raw.source || '',
    local: !!local,
    located: !!city,
  };
}

/* ---------------- 对外接口 ---------------- */

/**
 * 查询 IP 归属地（市级）。
 * 内网 / 本机地址无法定位，改为查询服务器出口 IP —— 本地开发时和用户在同一网络，城市一般是对的。
 */
export async function locate(ip) {
  const clean = normalizeIp(ip);
  const local = isLocalIp(clean);
  const key = local ? SELF_KEY : clean;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.data.located ? CACHE_TTL : FAIL_TTL)) {
    return { ...hit.data, cached: true };
  }

  for (const fn of SOURCES) {
    try {
      const raw = await fn(local ? '' : clean);
      const data = shape(raw, clean, local);
      if (!data.city) throw new Error('未解析到城市');
      cache.set(key, { at: Date.now(), data });
      trimCache();
      return data;
    } catch (e) {
      // 换下一个数据源
    }
  }

  const fail = { city: '', province: '', country: '', ip: clean, source: '', local, located: false };
  cache.set(key, { at: Date.now(), data: fail });
  trimCache();
  return fail;
}

function trimCache() {
  if (cache.size <= CACHE_MAX) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].at - b[1].at);
  for (let i = 0; i < entries.length - CACHE_MAX + 40; i += 1) cache.delete(entries[i][0]);
}
