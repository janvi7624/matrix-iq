'use client';

import calcStyles from '../calculator.module.css';
import styles from '../materials.module.css';

export interface AssignableRole {
  key: string;
  label: string;
}

/**
 * "Who can see this" for a Material library folder or document.
 *
 * Expressed as "everyone, or these roles" rather than as a checkbox per role
 * with none ticked meaning everyone, because those two states look identical
 * and mean opposite things. An empty tick list is the single most dangerous
 * state this control can produce — it is a folder nobody can open, including
 * the person who just made it — so the control never lets you arrive there by
 * unticking: clearing the last role returns to Everyone.
 *
 * The rule itself is lib/materialRoleVisibility.ts; this only edits the list.
 */
export default function RoleScopePicker({
  roles,
  value,
  onChange,
  label,
  hint,
  parentNarrowing
}: {
  roles: AssignableRole[];
  /** [] = every internal role. */
  value: string[];
  onChange: (next: string[]) => void;
  label: string;
  hint: string;
  /**
   * The roles a folder ABOVE this one is already narrowed to, if any.
   *
   * Shown because of the folder-chain gate: narrowing a document to `hr`
   * inside a folder narrowed to `engineer` makes it reachable by nobody, and
   * that is invisible from inside this control alone.
   */
  parentNarrowing?: string[];
}) {
  const everyone = value.length === 0;

  function toggle(key: string) {
    const next = value.includes(key) ? value.filter((entry) => entry !== key) : [...value, key];
    onChange(next);
  }

  // Which of the ticked roles the folder above would block anyway.
  const blocked = parentNarrowing?.length
    ? value.filter((role) => !parentNarrowing.includes(role))
    : [];

  return (
    <div className={calcStyles.field}>
      <label>{label}</label>
      <span className={calcStyles.small}>{hint}</span>

      <div className={styles.roleScopeRow}>
        <button
          type="button"
          className={everyone ? styles.roleScopeChipOn : styles.roleScopeChip}
          onClick={() => onChange([])}
          aria-pressed={everyone}
        >
          Everyone
        </button>
        {roles.map((role) => {
          const on = value.includes(role.key);
          return (
            <button
              key={role.key}
              type="button"
              className={on ? styles.roleScopeChipOn : styles.roleScopeChip}
              onClick={() => toggle(role.key)}
              aria-pressed={on}
            >
              {role.label}
            </button>
          );
        })}
      </div>

      {!everyone && blocked.length > 0 && (
        <div className={styles.fieldWarn}>
          A folder above this one is limited to {parentNarrowing!.join(', ')}, so {blocked.join(', ')} still won’t
          reach this. Widen the folder above, or pick from its roles.
        </div>
      )}
    </div>
  );
}
