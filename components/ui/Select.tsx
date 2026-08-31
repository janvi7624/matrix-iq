'use client';

import { SelectHTMLAttributes } from 'react';
import calcStyles from '../calculator.module.css';
import controlsStyles from './controls.module.css';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Shrinks the select to its content width instead of filling the row (toolbar filters). */
  auto?: boolean;
}

export default function Select({ className, auto, ...rest }: SelectProps) {
  const classes = [calcStyles.formControl, auto ? controlsStyles.selectAuto : '', className || ''].filter(Boolean).join(' ');
  return <select className={classes} {...rest} />;
}
