import { StatusBadge } from "../../components/StatusBadge";
import type { ViewName } from "../../types";

const VIEW_LABELS: Record<ViewName, string> = {
  trial: "재판",
  evidence: "증거",
  comparison: "비교",
  receipt: "영수증",
};
const STAGES = ["캡처", "재현", "변론", "패치", "재심", "판결"];

interface LivePendingProps {
  activeIndex: number;
  events: Array<{ time: string; stage: string; message: string }>;
  notice: string;
  view: ViewName;
}

export function LivePending({ activeIndex, events, notice, view }: LivePendingProps) {
  const stage = STAGES[Math.max(0, activeIndex)] ?? STAGES[0];
  return (
    <section className="live-pending" aria-labelledby="live-pending-heading">
      <header>
        <div>
          <span>LIVE RUN · SEALED UNTIL OBSERVED</span>
          <h1 id="live-pending-heading">실시간 {VIEW_LABELS[view]}를 준비하고 있습니다.</h1>
          <p>이 run에서 직접 수집한 값만 표시합니다. 저장된 리플레이의 점수·결함·변종은 섞지 않습니다.</p>
        </div>
        <StatusBadge status="pending" />
      </header>
      <div className="live-pending__body">
        <div className="live-scan" aria-hidden="true"><span>{stage}</span><i /></div>
        <div className="live-event-sheet">
          <strong>{notice}</strong>
          <ol>
            {events.map((event, index) => (
              <li key={`${event.time}-${index}`}>
                <time>{event.time}</time>
                <span>{event.stage}</span>
                <p>{event.message}</p>
              </li>
            ))}
          </ol>
          {events.length === 0 ? <p className="empty-live-event">첫 named SSE event를 기다리는 중입니다.</p> : null}
        </div>
      </div>
    </section>
  );
}
