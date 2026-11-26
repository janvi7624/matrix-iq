'use client';

import {
  ChangeEvent,
  Children,
  CSSProperties,
  FocusEvent,
  Fragment,
  isValidElement,
  ReactNode,
  useMemo,
  useState
} from 'react';
import Dropdown, { DropdownOption } from './Dropdown';

/**
 * Drop-in replacement for a native single `<select>` that renders the app's
 * common Dropdown (components/ui/Dropdown) — same look everywhere, search
 * for long lists, keyboard support.
 *
 *   <Select value={x} onChange={(e) => setX(e.target.value)}>
 *     <option value="">All statuses</option>
 *     <option value="open">Open</option>
 *     <optgroup label="Closed">…</optgroup>
 *   </Select>
 *
 * - Write it exactly like a `<select>`: `<option>` / `<optgroup>` children
 *   (fragments, arrays and conditionals are fine), `value` or
 *   `defaultValue`, `onChange(e)` with `e.target.value`, `name`,
 *   `required`, `disabled`, `id` (so `<label htmlFor>` works).
 * - An `<option value="">` becomes the placeholder (shown when nothing is
 *   chosen) and the ✕ clear action.
 * - `auto` sizes to the content (toolbar filters); otherwise it fills the
 *   row like a form field.
 * - For filters where several values can apply, use Dropdown with
 *   `multiselect` directly.
 */
export interface SelectProps {
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
  /** Value-only change callback (alternative to onChange). */
  onValueChange?: (value: string) => void;
  children?: ReactNode;
  /** Shrinks to the content width instead of filling the row (toolbar filters). */
  auto?: boolean;
  /** 'sm' for dense toolbars and table footers. */
  dropdownSize?: 'md' | 'sm';
  /** Search box in the panel (default: on for more than 8 options). */
  searchable?: boolean;
  /** Placeholder when there's no empty option (default "Select…"). */
  placeholder?: string;
  /** Muted prefix shown with a value, e.g. "Status" → "Status: Open". */
  label?: string;
  icon?: ReactNode;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
  autoFocus?: boolean;
  onBlur?: (e: FocusEvent<HTMLButtonElement>) => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  /** Accepted for <select> compatibility; ignored. */
  size?: number;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

interface Parsed {
  options: DropdownOption[];
  /** Label of the value="" option, if there is one. */
  emptyLabel: string | null;
  emptyDisabled: boolean;
}

/** Reads <option>/<optgroup> children into Dropdown options. Pure — exported for tests. */
export function parseSelectChildren(children: ReactNode): Parsed {
  const out: Parsed = { options: [], emptyLabel: null, emptyDisabled: false };
  const seen = new Set<string>();
  const walk = (nodes: ReactNode, group?: string) => {
    Children.forEach(nodes, (child) => {
      if (!isValidElement(child)) return;
      const props = child.props as {
        children?: ReactNode;
        value?: string | number;
        label?: string;
        disabled?: boolean;
        hidden?: boolean;
      };
      if (child.type === Fragment) return walk(props.children, group);
      if (child.type === 'optgroup') return walk(props.children, props.label || group);
      if (child.type !== 'option' || props.hidden) return;
      const label = textOf(props.children).trim() || String(props.value ?? '');
      const value = props.value !== undefined ? String(props.value) : label;
      if (value === '') {
        if (out.emptyLabel === null) {
          out.emptyLabel = label;
          out.emptyDisabled = !!props.disabled;
        }
        return;
      }
      if (seen.has(value)) return;
      seen.add(value);
      out.options.push({ value, label, disabled: props.disabled, group });
    });
  };
  walk(children);
  return out;
}

const asString = (v: SelectProps['value']) => (v == null ? undefined : Array.isArray(v) ? String(v[0] ?? '') : String(v));

export default function Select({
  value,
  defaultValue,
  onChange,
  onValueChange,
  children,
  auto,
  dropdownSize,
  searchable,
  placeholder,
  label,
  icon,
  id,
  name,
  required,
  disabled,
  className,
  style,
  title,
  autoFocus,
  onBlur,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid
}: SelectProps) {
  const parsed = useMemo(() => parseSelectChildren(children), [children]);
  const controlled = value !== undefined;
  // Uncontrolled like a native select: defaultValue, else the first option.
  const [inner, setInner] = useState<string>(
    () => asString(defaultValue) ?? (parsed.emptyLabel !== null ? '' : parsed.options[0]?.value ?? '')
  );
  const current = controlled ? asString(value) ?? '' : inner;

  function change(next: string) {
    if (!controlled) setInner(next);
    onValueChange?.(next);
    if (onChange) {
      // Shaped like the change event of a <select>: handlers read e.target.value (and .name / .id).
      const target = { value: next, name: name ?? '', id: id ?? '', type: 'select-one' };
      onChange({
        target,
        currentTarget: target,
        type: 'change',
        preventDefault() {},
        stopPropagation() {},
        persist() {}
      } as unknown as ChangeEvent<HTMLSelectElement>);
    }
  }

  return (
    <Dropdown
      options={parsed.options}
      value={current}
      onChange={change}
      placeholder={parsed.emptyLabel ?? placeholder ?? 'Select…'}
      // The ✕ only where the list itself offers "nothing" (an empty option that isn't disabled).
      clearable={parsed.emptyLabel !== null && !parsed.emptyDisabled}
      searchable={searchable}
      label={label}
      icon={icon}
      size={dropdownSize}
      fullWidth={!auto}
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      className={className}
      style={style}
      title={title}
      autoFocus={autoFocus}
      onBlur={onBlur}
      ariaLabel={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
    />
  );
}
