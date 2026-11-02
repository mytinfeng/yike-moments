const TOKEN_KEY = 'pyq_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(method, url, body, isForm) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !isForm) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `请求失败 (${res.status})`);
    err.status = res.status;
    err.data = data;
    err.retryAfter =
      Number(data && data.retryAfter) || Number(res.headers.get('Retry-After')) || 0;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body || {}),
  put: (url, body) => request('PUT', url, body || {}),
  del: (url, body) => request('DELETE', url, body || undefined),
  upload(files) {
    const fd = new FormData();
    for (const f of files) fd.append('file', f);
    return request('POST', '/api/upload', fd, true);
  },
  /** 传文件到指定接口（可指定字段名），表情包上传用 */
  uploadTo(url, files, field = 'files') {
    const fd = new FormData();
    for (const f of files) fd.append(field, f);
    return request('POST', url, fd, true);
  },
};
