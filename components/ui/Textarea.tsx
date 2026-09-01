'use client';

import { TextareaHTMLAttributes } from 'react';
import calcStyles from '../calculator.module.css';

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export default function Textarea({ className, ...rest }: TextareaProps) {
  const classes = [calcStyles.formControl, className || ''].filter(Boolean).join(' ');
  return <textarea className={classes} {...rest} />;
}
