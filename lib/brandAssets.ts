// Static imports of the logo images used by the app chrome (header,
// sidebar, partner portal header).
//
// Why static imports instead of BRAND.logoWeb / BRAND.iconMark ('/...'
// paths into public/): every page renders its own AppShell, so the header
// and sidebar remount on each navigation and the logo <img> is recreated.
// A public/ file is served with no long cache lifetime, so each remount
// re-checked it with the server and the logo visibly blinked. A statically
// imported image is emitted under /_next/static/media/<hash>.<ext> with
// `Cache-Control: public, max-age=31536000, immutable` (see Next's headers
// docs), so a remount paints straight from the browser's memory cache — no
// request, no blink. The hash changes if the file changes, so a new logo
// still shows up immediately after a deploy.
//
// BRAND (lib/branding.ts) keeps the plain paths for everything that needs a
// URL string (emails, PDFs, metadata, favicon).
import logoWeb from '@/public/nanta-logo.webp';
import iconMark from '@/public/nanta-icon.png';

export const BRAND_ASSETS = { logoWeb, iconMark } as const;
