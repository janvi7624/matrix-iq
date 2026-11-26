import PortalHeader from './PortalHeader';
import SessionTimeoutWatcher from './SessionTimeoutWatcher';
import Sidebar from './Sidebar';
import type { CommonHeaderAction, CommonHeaderMenuItem } from './ui/CommonHeader';
import historyStyles from './quotationHistory.module.css';
import shellStyles from './sidebar.module.css';

interface AppShellProps {
  title: string;
  subtitle: string;
  headerActions?: CommonHeaderAction[];
  headerMenu?: CommonHeaderMenuItem[];
  children: React.ReactNode;
  /**
   * List pages: the page itself doesn't scroll — the content fills exactly
   * one screen and the main table takes the remaining height, scrolling
   * inside with its pager right underneath (globals.css .mx-fill-page).
   * The table wrapper must be .mx-rtable-wrap, directly inside the content
   * or inside containers marked .mx-fill-grow.
   */
  fillPage?: boolean;
}

// Drop-in replacement for the old per-page
// `<div body><PortalHeader/><main>{content}</main></div>` boilerplate —
// adds the role-authorized Sidebar around every page that uses it, without
// each page needing its own layout logic. The header is the shared
// CommonHeader (via PortalHeader) and has no back button: sub-pages put
// components/ui/PageBackButton first in their own top row.
export default function AppShell({ title, subtitle, headerActions, headerMenu, fillPage = false, children }: AppShellProps) {
  return (
    <div className={historyStyles.body}>
      {/* Every signed-in page goes through AppShell, and the login page does
          not — so this is exactly the set of pages an idle-timeout warning
          belongs on. */}
      <SessionTimeoutWatcher />
      <PortalHeader title={title} subtitle={subtitle} headerActions={headerActions} headerMenu={headerMenu} />
      <div className={shellStyles.layout}>
        <Sidebar />
        <main className={shellStyles.shellMain}>
          {fillPage ? <div className="mx-fill-page">{children}</div> : children}
        </main>
      </div>
    </div>
  );
}
