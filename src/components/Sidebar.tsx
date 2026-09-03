import { FileEdit, Home, Settings, Upload } from "lucide-react";
import iconUrl from "../assets/Melodica_Logo.png";
import type { AppInfo } from "../lib/tauri";

export type AppTab = "home" | "upload" | "edit" | "settings";

export type ConnectionState =
  | { status: "checking" }
  | { status: "connected"; info: AppInfo }
  | { status: "error"; message: string };

type SidebarProps = {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  connection: ConnectionState;
};

const TABS: { id: AppTab; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "upload", label: "Upload", icon: Upload },
  { id: "edit", label: "Edit", icon: FileEdit },
  { id: "settings", label: "Settings", icon: Settings },
];

function connectionTitle(connection: ConnectionState): string {
  if (connection.status === "checking") return "Connecting…";
  if (connection.status === "connected") {
    return `${connection.info.name} v${connection.info.version}`;
  }
  return `Core unreachable: ${connection.message}`;
}

export function Sidebar({ activeTab, onTabChange, connection }: SidebarProps) {
  const statusTitle = connectionTitle(connection);

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <button
          type="button"
          className="brand-lockup"
          onClick={() => onTabChange("home")}
          aria-label="Melodica — go to Home"
        >
          <img src={iconUrl} alt="" className="brand-icon" width={56} height={56} />
          <span className="brand-name">Melodica</span>
        </button>

        <nav className="sidebar-nav" aria-label="Main">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`sidebar-nav-item${activeTab === id ? " is-active" : ""}`}
              aria-current={activeTab === id ? "page" : undefined}
              onClick={() => onTabChange(id)}
            >
              <Icon className="sidebar-nav-icon" size={20} strokeWidth={2} aria-hidden />
              <span className="sidebar-nav-label">{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <footer
        className="sidebar-status"
        aria-live="polite"
        title={statusTitle}
      >
        <span
          className={`sidebar-status-dot sidebar-status-dot--${connection.status}`}
          aria-hidden
        />
        {connection.status === "checking" && (
          <p className="sidebar-status-text muted">Connecting…</p>
        )}
        {connection.status === "connected" && (
          <p className="sidebar-status-text muted">
            <code>
              {connection.info.name} v{connection.info.version}
            </code>
          </p>
        )}
        {connection.status === "error" && (
          <p className="sidebar-status-text error">
            Core unreachable
            <span>{connection.message}</span>
          </p>
        )}
      </footer>
    </aside>
  );
}
