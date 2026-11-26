'use client';

import { ButtonHTMLAttributes, KeyboardEvent, ReactNode, useState } from 'react';
import { Check, X } from 'lucide-react';
import styles from './commonChip.module.css';

export type CommonChipSize = 'sm' | 'md' | 'lg';
/** Colour tone for a static (non-selectable) tag. Selectable chips ignore it. */
export type CommonChipTone = 'default' | 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

export interface CommonChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'children'> {
  label?: ReactNode;
  children?: ReactNode;
  size?: CommonChipSize;
  tone?: CommonChipTone;
  /** Controlled selected state. Leave undefined (and use defaultSelected) for uncontrolled. */
  selected?: boolean;
  defaultSelected?: boolean;
  /** Called with the next selected state on every click. */
  onSelectedChange?: (selected: boolean) => void;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Show a check mark while selected. Defaults to true for selectable chips. */
  showCheck?: boolean;
  /** Small count badge after the label (e.g. matching records). */
  count?: ReactNode;
  /** Renders a remove (×) control; the chip itself then becomes a static tag. */
  onRemove?: () => void;
  removeLabel?: string;
  /**
   * Expose the chip to assistive tech as a checkbox (role="checkbox" +
   * aria-checked) instead of a toggle button (aria-pressed) — for chips that
   * replace a checkbox in a form-like option list.
   */
  checkbox?: boolean;
}

export function commonChipClassName({
  size = 'md',
  tone = 'default',
  selected = false,
  interactive = false,
  disabled = false,
  removable = false,
  className
}: {
  size?: CommonChipSize;
  tone?: CommonChipTone;
  selected?: boolean;
  interactive?: boolean;
  disabled?: boolean;
  removable?: boolean;
  className?: string;
}): string {
  return [
    styles.root,
    styles[size],
    !selected && tone !== 'default' ? styles[tone] : '',
    interactive ? styles.interactive : '',
    selected ? styles.selected : '',
    disabled ? styles.disabled : '',
    removable ? styles.removable : '',
    className || ''
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Chip for filters, tags and selectable options.
 *
 * - interactive (renders a <button aria-pressed>) when it has onClick, onSelectedChange,
 *   `selected` or `defaultSelected`; otherwise a static <span> tag
 * - controlled (`selected` + `onSelectedChange`/`onClick`) or uncontrolled (`defaultSelected`)
 * - selected = solid brand fill + white text (+ optional check), unselected = white + border
 * - disabled, leading/trailing icon, count badge, removable (onRemove)
 */
export default function CommonChip({
  label,
  children,
  size = 'md',
  tone = 'default',
  selected: selectedProp,
  defaultSelected,
  onSelectedChange,
  onClick,
  leadingIcon,
  trailingIcon,
  showCheck,
  count,
  onRemove,
  removeLabel,
  checkbox = false,
  disabled,
  className,
  type = 'button',
  ...rest
}: CommonChipProps) {
  const [innerSelected, setInnerSelected] = useState(Boolean(defaultSelected));
  const controlled = selectedProp !== undefined;
  const selected = controlled ? Boolean(selectedProp) : innerSelected;
  const selectable = controlled || defaultSelected !== undefined || onSelectedChange !== undefined;
  const interactive = !onRemove && (selectable || onClick !== undefined);
  const text = label ?? children;
  const withCheck = showCheck ?? selectable;

  const body = (
    <>
      {selected && withCheck ? (
        <span className={styles.check} aria-hidden="true">
          <Check />
        </span>
      ) : (
        leadingIcon && (
          <span className={styles.icon} aria-hidden="true">
            {leadingIcon}
          </span>
        )
      )}
      <span className={styles.label}>{text}</span>
      {count !== undefined && count !== null && <span className={styles.count}>{count}</span>}
      {trailingIcon && (
        <span className={styles.icon} aria-hidden="true">
          {trailingIcon}
        </span>
      )}
    </>
  );

  if (onRemove) {
    return (
      <span className={commonChipClassName({ size, tone, selected, disabled, removable: true, className })} title={rest.title}>
        {body}
        <button
          type="button"
          className={styles.remove}
          onClick={onRemove}
          disabled={disabled}
          aria-label={removeLabel || (typeof text === 'string' ? `Remove ${text}` : 'Remove')}
        >
          <X />
        </button>
      </span>
    );
  }

  if (!interactive) {
    return (
      <span className={commonChipClassName({ size, tone, selected, disabled, className })} id={rest.id} title={rest.title}>
        {body}
      </span>
    );
  }

  return (
    <button
      type={type}
      className={commonChipClassName({ size, tone, selected, interactive: true, disabled, className })}
      role={checkbox ? 'checkbox' : undefined}
      aria-checked={checkbox ? selected : undefined}
      aria-pressed={selectable && !checkbox ? selected : undefined}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        if (selectable) {
          const next = !selected;
          if (!controlled) setInnerSelected(next);
          onSelectedChange?.(next);
        }
      }}
      {...rest}
    >
      {body}
    </button>
  );
}

export interface CommonChipOption<V extends string | number> {
  value: V;
  label: ReactNode;
  disabled?: boolean;
  leadingIcon?: ReactNode;
  count?: ReactNode;
  title?: string;
}

interface ChipGroupBase<V extends string | number> {
  options: CommonChipOption<V>[];
  size?: CommonChipSize;
  /** Accessible name for the group. */
  ariaLabel: string;
  /** Keep chips on one scrollable row instead of wrapping. */
  noWrap?: boolean;
  showCheck?: boolean;
  disabled?: boolean;
  className?: string;
  chipClassName?: string;
}

export interface CommonChipGroupSingleProps<V extends string | number> extends ChipGroupBase<V> {
  multiple?: false;
  value?: V | null;
  defaultValue?: V | null;
  onChange?: (value: V | null) => void;
  /** Allow clicking the selected chip to clear the selection. */
  allowDeselect?: boolean;
}

export interface CommonChipGroupMultiProps<V extends string | number> extends ChipGroupBase<V> {
  multiple: true;
  value?: V[];
  defaultValue?: V[];
  onChange?: (value: V[]) => void;
}

export type CommonChipGroupProps<V extends string | number> = CommonChipGroupSingleProps<V> | CommonChipGroupMultiProps<V>;

/** Pure selection reducer shared by both modes — exported for unit tests. */
export function nextChipSelection<V>(current: V[], clicked: V, multiple: boolean, allowDeselect: boolean): V[] {
  const isOn = current.includes(clicked);
  if (multiple) return isOn ? current.filter((v) => v !== clicked) : [...current, clicked];
  if (isOn) return allowDeselect ? [] : current;
  return [clicked];
}

/**
 * A set of CommonChips with single- or multi-selection, controlled or uncontrolled.
 * Arrow keys move focus between chips; Space/Enter toggles.
 */
export function CommonChipGroup<V extends string | number>(props: CommonChipGroupProps<V>) {
  const { options, size = 'md', ariaLabel, noWrap, showCheck, disabled, className, chipClassName } = props;
  const multiple = props.multiple === true;
  const toArray = (v: V | V[] | null | undefined): V[] => (v === null || v === undefined ? [] : Array.isArray(v) ? v : [v]);

  const [inner, setInner] = useState<V[]>(toArray(props.defaultValue));
  const controlled = props.value !== undefined;
  const current = controlled ? toArray(props.value) : inner;

  function select(v: V) {
    const next = nextChipSelection(current, v, multiple, !multiple && Boolean((props as CommonChipGroupSingleProps<V>).allowDeselect));
    if (!controlled) setInner(next);
    if (props.multiple === true) props.onChange?.(next);
    else props.onChange?.(next.length ? next[0] : null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (idx < 0) return;
    e.preventDefault();
    let next = idx;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % buttons.length;
    else next = (idx - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={[styles.group, noWrap ? styles.groupNoWrap : '', className || ''].filter(Boolean).join(' ')}
      onKeyDown={onKeyDown}
    >
      {options.map((opt) => (
        <CommonChip
          key={String(opt.value)}
          size={size}
          label={opt.label}
          title={opt.title}
          leadingIcon={opt.leadingIcon}
          count={opt.count}
          selected={current.includes(opt.value)}
          showCheck={showCheck}
          disabled={disabled || opt.disabled}
          className={chipClassName}
          onClick={() => select(opt.value)}
        />
      ))}
    </div>
  );
}
