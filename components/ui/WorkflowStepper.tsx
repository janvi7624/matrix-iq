import { ReactNode } from 'react';
import styles from '../quotationHistory.module.css';

export type StepState = 'done' | 'current' | 'upcoming' | 'skipped';

export interface StepperStep {
  key: string;
  label: string;
  state: StepState;
  meta?: ReactNode;
}

const DOT_CLASS: Record<StepState, string> = {
  done: styles.stepperDotDone,
  current: styles.stepperDotCurrent,
  upcoming: styles.stepperDotUpcoming,
  skipped: styles.stepperDotSkipped
};

const DOT_ICON: Record<StepState, string> = {
  done: '✓',
  current: '●',
  upcoming: '○',
  skipped: '✕'
};

// Vertical stage tracker — deliberately vertical at every width (not a
// horizontal pipeline that needs its own mobile rework). Reusable anywhere
// a record moves through an ordered set of stages, not just Demo Schedule.
export default function WorkflowStepper({ steps }: { steps: StepperStep[] }) {
  return (
    <div className={styles.stepper}>
      {steps.map((step, i) => {
        const isLineDone = step.state === 'done' && steps[i + 1]?.state !== 'upcoming';
        return (
          <div key={step.key} className={styles.stepperItem}>
            <div className={styles.stepperMarker}>
              <span className={`${styles.stepperDot} ${DOT_CLASS[step.state]}`} aria-hidden="true">
                {DOT_ICON[step.state]}
              </span>
              <span className={`${styles.stepperLine} ${isLineDone ? styles.stepperLineDone : ''}`} />
            </div>
            <div className={styles.stepperBody}>
              <div className={`${styles.stepperLabel} ${step.state === 'upcoming' ? styles.stepperLabelUpcoming : ''}`}>{step.label}</div>
              {step.meta && <div className={styles.stepperMeta}>{step.meta}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
