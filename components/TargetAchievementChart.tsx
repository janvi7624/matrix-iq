'use client';

import { useEffect, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney, formatMoneyCompact } from '@/lib/format';
import { SkeletonRows } from './ui/Skeleton';
import styles from './departmentHealthDetail.module.css';

// Target vs Achieved across the twelve months of a fiscal year — the
// trajectory behind the single-period tiles above it. Fetches its own data so
// changing the year costs ~12 rows rather than the whole person review, and
// so nothing is requested at all for a viewer the Target block is hidden from.

const TARGET_COLOR = '#94a3b8';
const ACHIEVED_COLOR = '#2563eb';

interface SeriesPoint {
  key: string;
  label: string;
  fullLabel: string;
  target: number;
  achieved: number | null;
  achievementPercent: number | null;
  state: 'past' | 'current' | 'future';
}

interface SeriesResponse {
  fiscalYear: string;
  points: SeriesPoint[];
  totals: { target: number; achieved: number; achievementPercent: number };
  annualTarget: number;
  hasAnyTarget: boolean;
  hasAnyAchievement: boolean;
  fiscalYearOptions: string[];
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: SeriesPoint }[] }) {
  if (!active || !payload || !payload.length) return null;
  const point = payload[0].payload;
  return (
    <div className={styles.chartTooltip}>
      <div className={styles.chartTooltipTitle}>{point.fullLabel}</div>
      <div>Target: {formatMoney(point.target)}</div>
      <div>
        Achieved:{' '}
        {point.achieved === null ? <span className={styles.chartTooltipMuted}>month not started</span> : formatMoney(point.achieved)}
      </div>
      {point.achieved !== null && point.target > 0 ? <div>{point.achievementPercent}% of target</div> : null}
    </div>
  );
}

export default function TargetAchievementChart({ username }: { username: string }) {
  const [fiscalYear, setFiscalYear] = useState('');
  const [data, setData] = useState<SeriesResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const query = fiscalYear ? `?fiscalYear=${encodeURIComponent(fiscalYear)}` : '';
    fetch(`/api/dashboard/person/${encodeURIComponent(username)}/target-series${query}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Server responded with ${r.status}`);
        return r.json();
      })
      .then((json: SeriesResponse) => {
        if (cancelled) return;
        setData(json);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || 'Could not load the target trend.');
      });
    return () => {
      cancelled = true;
    };
  }, [username, fiscalYear]);

  if (error) {
    return <div className={styles.chartPanel}><div className={styles.chartEmpty}>{error}</div></div>;
  }
  if (!data) {
    return <div className={styles.chartPanel}><SkeletonRows rows={3} columns={2} /></div>;
  }

  return (
    <div className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <div className={styles.chartTitle}>
          Monthly trend — FY {data.fiscalYear}
          {data.hasAnyTarget ? (
            <span className={styles.chartSubtitle}>
              {formatMoney(data.totals.achieved)} of {formatMoney(data.totals.target)} so far · {data.totals.achievementPercent}%
            </span>
          ) : null}
        </div>
        <div className={styles.yearChips} role="group" aria-label="Fiscal year">
          {data.fiscalYearOptions.map((year) => (
            <button
              key={year}
              type="button"
              className={`${styles.yearChip} ${year === data.fiscalYear ? styles.yearChipActive : ''}`}
              aria-pressed={year === data.fiscalYear}
              onClick={() => {
                if (year === data.fiscalYear) return;
                setData(null);
                setError('');
                setFiscalYear(year);
              }}
            >
              {year}
            </button>
          ))}
        </div>
      </div>

      {!data.hasAnyTarget && !data.hasAnyAchievement ? (
        <div className={styles.chartEmpty}>No targets set and nothing closed in FY {data.fiscalYear}.</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data.points} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => formatMoneyCompact(v)} width={58} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="target"
              name="Target"
              stroke={TARGET_COLOR}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
            />
            {/* connectNulls stays off on purpose: a month that has not started
                has achieved=null, and bridging the gap would draw a straight
                line across the rest of the year as if it were performance. */}
            <Line
              type="monotone"
              dataKey="achieved"
              name="Achieved"
              stroke={ACHIEVED_COLOR}
              strokeWidth={2.5}
              connectNulls={false}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
