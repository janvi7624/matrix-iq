import { ReactNode } from 'react';
import historyStyles from '../quotationHistory.module.css';

// Wraps quotationHistory.module.css's .toolbar. Note: `.toolbar
// input[type="text"]` is a descendant selector there, so a bare <input>
// child automatically gets full-width search-input styling — keep a plain
// search <input> as a direct child rather than wrapping it in <Input>,
// which would opt it out of that rule.
export default function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  const classes = [historyStyles.toolbar, className || ''].filter(Boolean).join(' ');
  return <div className={classes}>{children}</div>;
}
