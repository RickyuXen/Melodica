import { useEffect, useState } from "react";
import { getAppInfo, type AppInfo } from "./lib/tauri";
import "./App.css";

type ConnectionState =
  | { status: "checking" }
  | { status: "connected"; info: AppInfo }
  | { status: "error"; message: string };

function App() {
  const [connection, setConnection] = useState<ConnectionState>({
    status: "checking",
  });

  useEffect(() => {
    let cancelled = false;

    getAppInfo()
      .then((info) => {
        if (!cancelled) setConnection({ status: "connected", info });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to reach Rust core";
          setConnection({ status: "error", message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="shell">
      <header className="brand">
        <h1>Melodica</h1>
        <p>Learn languages through the music you already like.</p>
      </header>

      <section className="status" aria-live="polite">
        {connection.status === "checking" && (
          <p>Connecting to Rust core…</p>
        )}
        {connection.status === "connected" && (
          <p>
            Connected to{" "}
            <code>
              {connection.info.name} v{connection.info.version}
            </code>
          </p>
        )}
        {connection.status === "error" && (
          <p className="error">
            Rust core unreachable. Run via <code>npm run tauri dev</code>.
            <br />
            <span>{connection.message}</span>
          </p>
        )}
      </section>

      <section className="placeholder">
        <p>Player controls, library, and lyrics panel come next.</p>
      </section>
    </main>
  );
}

export default App;
