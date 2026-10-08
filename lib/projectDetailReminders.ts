import { QueryTypes } from 'sequelize';
import { sequelize } from './db';
import { checkProjectCompleteness, PROJECT_FIELD_LABEL } from './projectCompleteness';
import { sendMissingProjectDetailsEmail } from './email/notifications';

// Projects whose mandatory details are still blank, grouped by the person who
// owns them, plus the one-click send that nags each of them about their own.
//
// Built on the app's OWN rules rather than a fresh list of "important" fields,
// because a reminder that disagrees with the app is worse than none:
//   Sales -> checkProjectCompleteness (lib/projectCompleteness.ts), the exact
//            rule the project page's "Complete Project Details" panel shows.
//            Note it deliberately does NOT count `departments`: that is
//            required at creation only, and counting it would reach backwards
//            over ~130 projects nobody was ever asked to fill it in for (see
//            the comment in app/api/projects/route.ts).
//   TMS   -> the setup gaps the project hub already calls out itself, i.e.
//            no project manager and no tasks broken down yet (the `attention`
//            list in components/TmsProjectDetailView.tsx). The TMS create
//            route only ever requires a name and a department, so nothing
//            else there can honestly be called mandatory.
//
// Everything here is read-only until sendProjectDetailReminders is called.

export interface ReminderItem {
  kind: 'Sales' | 'TMS';
  label: string;
  missing: string[];
}

export interface ReminderPerson {
  username: string;
  name: string;
  email: string;
  active: boolean;
  items: ReminderItem[];
}

export interface ReminderReport {
  /** Have an email and an active account — these are the ones a send would reach. */
  mailable: ReminderPerson[];
  /** Nobody to write to: no owner on the project, no address on file, or left the company. */
  unreachable: ReminderPerson[];
  salesScanned: number;
  tmsScanned: number;
  projectsWithGaps: number;
}

interface SalesRow {
  label: string;
  owner_username: string | null;
  approx_price: string | number | null;
  expected_closing_date: string | null;
  remarks: string | null;
  project_lead_id: string | null;
  opportunity_type: string | null;
}

interface TmsRow {
  project_code: string;
  label: string;
  owner_username: string | null;
  task_count: string | number;
}

interface OwnerRow {
  username: string;
  name: string | null;
  email: string | null;
  status: string;
}

const NO_OWNER = '(no owner)';

export async function buildProjectDetailReminderReport(): Promise<ReminderReport> {
  // 'lost' is excluded: a dead deal's blank fields are nobody's homework.
  const salesRows = await sequelize.query<SalesRow>(
    `SELECT COALESCE(NULLIF(p.client_name, ''), p.company, '(unnamed)') AS label,
            COALESCE(NULLIF(p.sales_person, ''), c.username) AS owner_username,
            p.approx_price, p.expected_closing_date, p.remarks, p.project_lead_id, p.opportunity_type
       FROM projects p
       LEFT JOIN users c ON c.id = p.created_by
      WHERE p.deleted_at IS NULL AND p.status <> 'lost'
      ORDER BY owner_username, label`,
    { type: QueryTypes.SELECT }
  );

  const tmsRows = await sequelize.query<TmsRow>(
    `SELECT tp.project_code,
            COALESCE(NULLIF(tp.name, ''), tp.client_name, tp.project_code) AS label,
            m.username AS owner_username,
            (SELECT COUNT(*) FROM tms_tasks t
              WHERE t.project_id = tp.id AND t.deleted_at IS NULL) AS task_count
       FROM tms_projects tp
       LEFT JOIN users m ON m.id = tp.project_manager_id
      WHERE tp.deleted_at IS NULL AND tp.status NOT IN ('completed', 'cancelled')
      ORDER BY owner_username, tp.project_code`,
    { type: QueryTypes.SELECT }
  );

  const byPerson = new Map<string, ReminderItem[]>();
  const add = (who: string, item: ReminderItem) => {
    if (!item.missing.length) return;
    const list = byPerson.get(who);
    if (list) list.push(item);
    else byPerson.set(who, [item]);
  };

  for (const row of salesRows) {
    const { missingFields } = checkProjectCompleteness({
      // The DECIMAL column arrives as a string from pg; '' is what
      // checkProjectCompleteness treats as absent.
      approx_price: row.approx_price === null ? '' : Number(row.approx_price),
      expected_closing_date: row.expected_closing_date ? String(row.expected_closing_date) : '',
      remarks: row.remarks || '',
      project_lead_id: row.project_lead_id || '',
      opportunity_type: row.opportunity_type || ''
    });
    add(row.owner_username || NO_OWNER, {
      kind: 'Sales',
      label: row.label,
      missing: missingFields.map((f) => PROJECT_FIELD_LABEL[f])
    });
  }

  for (const row of tmsRows) {
    const missing: string[] = [];
    // No owner is itself the gap, and it is also why there is nobody to tell —
    // these land in `unreachable` so an admin can see them and assign someone.
    if (!row.owner_username) missing.push('Project owner');
    if (Number(row.task_count) === 0) missing.push('Tasks broken down');
    add(row.owner_username || NO_OWNER, {
      kind: 'TMS',
      label: `${row.project_code} — ${row.label}`,
      missing
    });
  }

  const usernames = [...byPerson.keys()].filter((u) => u !== NO_OWNER);
  const owners = usernames.length
    ? await sequelize.query<OwnerRow>('SELECT username, name, email, status FROM users WHERE username = ANY($usernames)', {
        bind: { usernames },
        type: QueryTypes.SELECT
      })
    : [];
  const byUsername = new Map(owners.map((o) => [o.username, o]));

  const mailable: ReminderPerson[] = [];
  const unreachable: ReminderPerson[] = [];
  let projectsWithGaps = 0;

  // Biggest backlog first — that is the order someone reading the preview
  // wants, and the order the email list itself is built in.
  const sorted = [...byPerson.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [username, items] of sorted) {
    const owner = byUsername.get(username);
    const person: ReminderPerson = {
      username,
      name: owner?.name || username,
      email: owner?.email || '',
      active: owner?.status === 'active',
      items
    };
    projectsWithGaps += items.length;
    if (person.email && person.active) mailable.push(person);
    else unreachable.push(person);
  }

  return { mailable, unreachable, salesScanned: salesRows.length, tmsScanned: tmsRows.length, projectsWithGaps };
}

export interface SendReminderResult {
  sent: string[];
  failed: { email: string; name: string }[];
  skipped: number;
}

// Sends one email per person, each listing only that person's own projects.
// `onlyUsernames` lets the caller narrow a send to a subset of the preview it
// was just shown, so the button can never mail someone who was not on screen.
export async function sendProjectDetailReminders(onlyUsernames?: string[]): Promise<SendReminderResult> {
  const report = await buildProjectDetailReminderReport();
  const wanted = onlyUsernames && onlyUsernames.length ? new Set(onlyUsernames) : null;
  const targets = wanted ? report.mailable.filter((p) => wanted.has(p.username)) : report.mailable;

  const sent: string[] = [];
  const failed: { email: string; name: string }[] = [];
  for (const person of targets) {
    const ok = await sendMissingProjectDetailsEmail({ email: person.email, name: person.name, items: person.items });
    if (ok) sent.push(person.email);
    else failed.push({ email: person.email, name: person.name });
  }

  return { sent, failed, skipped: report.unreachable.length };
}
