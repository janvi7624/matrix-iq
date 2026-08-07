import PortalHeader from './PortalHeader';
import Sidebar from './Sidebar';
import historyStyles from './quotationHistory.module.css';
import shellStyles from './sidebar.module.css';

interface AppShellProps {
  title: string;
  subtitle: string;
  showBackLink?: boolean;
  children: React.ReactNode;
}

// Drop-in replacement for the old per-page
// `<div body><PortalHeader/><main>{content}</main></div>` boilerplate —
// adds the role-authorized Sidebar around every page that uses it, without
// each page needing its own layout logic.
export default function AppShell({ title, subtitle, showBackLink, children }: AppShellProps) {
  return (
    <div className={historyStyles.body}>
      <PortalHeader title={title} subtitle={subtitle} showBackLink={showBackLink} />
      <div className={shellStyles.layout}>
        <Sidebar />
        <main className={shellStyles.shellMain}>{children}</main>
      </div>
    </div>
  );
}
