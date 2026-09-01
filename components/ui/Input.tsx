'use client';

import { InputHTMLAttributes } from 'react';
import calcStyles from '../calculator.module.css';
import controlsStyles from './controls.module.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Shrinks the input to its content width instead of filling the row (toolbar filters, e.g. a date picker). */
  auto?: boolean;
}

export default function Input({ className, auto, ...rest }: InputProps) {
  const classes = [calcStyles.formControl, auto ? controlsStyles.selectAuto : '', className || ''].filter(Boolean).join(' ');
  return <input className={classes} {...rest} />;
}
