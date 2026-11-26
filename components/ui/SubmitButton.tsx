'use client';

import { ButtonHTMLAttributes } from 'react';
import CommonButton from './CommonButton';

export type SubmitButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

// Back-compat wrapper: the primary "save this new record" submit button,
// now rendered through CommonButton.
export default function SubmitButton({ type = 'submit', ...rest }: SubmitButtonProps) {
  return <CommonButton variant="primary" type={type} {...rest} />;
}
