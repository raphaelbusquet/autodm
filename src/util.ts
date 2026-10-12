const enc = new TextEncoder();

export async function hmacSha256Hex(secret: string, data: ArrayBuffer | string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, typeof data === 'string' ? enc.encode(data) : data);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomToken(bytes = 16): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok || body?.error) {
    const msg = body?.error?.message ?? body?.error_description ?? body?.error ?? text;
    throw new Error(`${res.status} ${url.split('?')[0]}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return body as T;
}
