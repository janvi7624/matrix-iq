import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/landingContent';

// Only the public marketing pages are indexable; everything else is the
// signed-in app (and would only ever show a login redirect anyway).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: ['/$', '/request-demo', '/login'], disallow: ['/'] }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url
  };
}
