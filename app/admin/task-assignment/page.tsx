import { redirect } from 'next/navigation';

// "Assign Task" was upgraded in place into Task Planner (same GeneralTask
// engine, same module key 'admin-task-assignment') — this old URL is kept
// as a safe redirect rather than removed outright, per the backward-
// compatibility requirement, in case anything still links here.
export default function AdminTaskAssignmentPage() {
  redirect('/admin/task-planner');
}
