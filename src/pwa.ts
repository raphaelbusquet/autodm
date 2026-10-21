import icon180 from './icons/icon-180.png';
import icon192 from './icons/icon-192.png';
import icon512 from './icons/icon-512.png';

export const ICONS: Record<string, ArrayBuffer> = {
  'apple-touch-icon.png': icon180,
  'icon-192.png': icon192,
  'icon-512.png': icon512,
};

export const MANIFEST = {
  name: 'AutoDM',
  short_name: 'AutoDM',
  start_url: '/admin',
  scope: '/',
  display: 'standalone',
  background_color: '#06060E',
  theme_color: '#06060E',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
};

export function loginPage(error = false): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>AutoDM</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="AutoDM">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#06060E">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap">
<style>
:root { --bg: #06060E; --surface: #10101C; --fg: #ECECF6; --muted: #8C8CA8; --accent: #4340EE; --danger: #F0566A; color-scheme: dark; }
@media (prefers-color-scheme: light) { :root { --bg: #F3F3F9; --surface: #FFFFFF; --fg: #12121F; --muted: #5E5E78; color-scheme: light; } }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--fg); font: 400 16px/1.5 'Poppins', system-ui, sans-serif; display: grid; place-items: center;
  padding: env(safe-area-inset-top, 0px) 16px env(safe-area-inset-bottom, 0px); }
form { width: min(340px, 100%); display: grid; gap: 14px; text-align: center; }
img { width: 72px; height: 72px; border-radius: 18px; justify-self: center; }
h1 { margin: 0 0 6px; font-size: 22px; font-weight: 600; }
input { font: inherit; font-size: 16px; padding: 13px 14px; border-radius: 12px; border: 1px solid transparent; background: var(--surface); color: var(--fg); }
input:focus { outline: 2px solid var(--accent); }
button { font: inherit; font-weight: 500; padding: 13px; border: 0; border-radius: 12px; background: var(--accent); color: #fff; }
p { margin: 0; color: var(--danger); font-size: 14px; }
</style></head><body>
<form method="post" action="/login">
  <img src="/apple-touch-icon.png" alt="">
  <h1>AutoDM</h1>
  <input type="password" name="password" placeholder="Senha" autocomplete="current-password" required autofocus>
  ${error ? '<p>Senha incorreta</p>' : ''}
  <button type="submit">Entrar</button>
</form>
</body></html>`;
}
