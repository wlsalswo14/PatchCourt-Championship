import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { RunRail } from "./RunRail";
import { PATCHCOURT_TARGET_URL } from "../config";
import type { RunMode, ViewName } from "../types";

const NAV_ITEMS: Array<{ id: ViewName; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
  { id: "trial", label: "재판", icon: "scale" },
  { id: "evidence", label: "증거", icon: "evidence" },
  { id: "comparison", label: "비교", icon: "compare" },
  { id: "receipt", label: "영수증", icon: "receipt" },
];

interface AppShellProps {
  activeIndex: number;
  children: ReactNode;
  mode: RunMode;
  onViewChange: (view: ViewName) => void;
  receiptId: string;
  terminalLabel?: "판결" | "기각" | "무효" | "승격";
  view: ViewName;
}

export function AppShell({
  activeIndex,
  children,
  mode,
  onViewChange,
  receiptId,
  terminalLabel,
  view,
}: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        본문으로 건너뛰기
      </a>
      <header className="app-header">
        <button className="brand" type="button" onClick={() => onViewChange("trial")}>
          <span className="brand-mark" aria-hidden="true">
            PC
          </span>
          <span>PATCHCOURT</span>
        </button>
        <div className="run-provenance">
          <span className={`mode-indicator mode-indicator--${mode}`}>
            <span aria-hidden="true" />
            {mode === "live" ? "실시간 재판" : "검증된 리플레이"}
          </span>
          <span className="receipt-id">{receiptId}</span>
        </div>
        <nav className="primary-nav" aria-label="주요 화면">
          {NAV_ITEMS.map((item) => (
            <button
              aria-current={view === item.id ? "page" : undefined}
              className="nav-button"
              key={item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </header>
      <div className="workspace-bar">
        <div className="workspace-name">
          <span aria-hidden="true" />
          <strong>PC01</strong>
          <span>브랜드-크리에이터 제안 여정</span>
        </div>
        <div className="workspace-target">
          <span>TARGET</span>
          <code>{PATCHCOURT_TARGET_URL.replace(/^https?:\/\//u, "")}</code>
        </div>
      </div>
      <RunRail activeIndex={activeIndex} terminalLabel={terminalLabel} />
      <main id="main-content" className="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
