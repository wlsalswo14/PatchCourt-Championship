import { Icon } from "./Icon";
import type { GateStatus } from "../types";

export function StatusBadge({ status }: { status: GateStatus }) {
  const label = status === "pass" ? "통과" : status === "fail" ? "실패" : "측정 대기";
  return (
    <span className={`status-badge status-badge--${status}`}>
      {status === "pass" ? <Icon name="check" size={13} /> : null}
      {status === "fail" ? <Icon name="x" size={13} /> : null}
      {label}
    </span>
  );
}
