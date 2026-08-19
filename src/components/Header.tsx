import iconUrl from "../assets/icon.svg";

export type AppTab = "home" | "upload" | "edit";

type HeaderProps = {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
};

const TABS: { id: AppTab; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "upload", label: "Upload" },
  { id: "edit", label: "Edit" },
];

export function Header({ activeTab, onTabChange }: HeaderProps) {
  return (
    <header className="site-header">
      <div className="navbar">
        <button
          type="button"
          className="brand-lockup"
          onClick={() => onTabChange("home")}
          aria-label="Melodica — go to Home"
        >
          <img src={iconUrl} alt="" className="brand-icon" width={28} height={28} />
          <span className="brand-name">Melodica</span>
        </button>

        <nav className="nav-tabs" aria-label="Main">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`nav-tab${activeTab === id ? " is-active" : ""}`}
              aria-current={activeTab === id ? "page" : undefined}
              onClick={() => onTabChange(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <p className="slogan">Learn languages through the music you already like.</p>
    </header>
  );
}
