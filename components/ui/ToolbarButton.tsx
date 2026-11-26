'use client';

import { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react';
import CommonButton from './CommonButton';

// Back-compat wrappers over CommonButton. ToolbarButton = secondary (or
// primary), ToolbarLink = a plain <a> styled as a secondary button (its
// callers point at file-download API routes, so it must not be next/link),
// DeleteButton = small destructive row action.
export default function ToolbarButton({ primary, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return <CommonButton variant={primary ? 'primary' : 'secondary'} {...rest} />;
}

export function ToolbarLink({ href = '#', ...rest }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <CommonButton href={href} native variant="secondary" {...rest} />;
}

export function DeleteButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <CommonButton variant="destructive" size="sm" {...props} />;
}
