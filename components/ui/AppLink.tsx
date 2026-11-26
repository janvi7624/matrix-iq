import NextLink from 'next/link';
import type { ComponentProps } from 'react';

export type AppLinkProps = ComponentProps<typeof NextLink>;

/**
 * The app's <Link>: next/link with prefetching OFF by default.
 *
 * next/link prefetches every route whose link scrolls into view (in
 * production). With a sidebar of ~60 module links, opening any page — the
 * dashboard right after login included — quietly loaded dozens of OTHER
 * pages' routes and server data in the background. A page should load only
 * its own data, so every in-app link goes through here instead.
 *
 * Pass `prefetch` explicitly for the rare link where warming the next route
 * is worth it. Works in both server and client components.
 */
export default function AppLink({ prefetch = false, ...props }: AppLinkProps) {
  return <NextLink prefetch={prefetch} {...props} />;
}
