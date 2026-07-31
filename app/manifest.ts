import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/branding';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${BRAND.appName} — ${BRAND.tagline}`,
    short_name: BRAND.shortName,
    description: BRAND.description,
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: BRAND.themeColor,
    icons: [
      {
        src: BRAND.favicon,
        sizes: 'any',
        type: 'image/png'
      }
    ]
  };
}
