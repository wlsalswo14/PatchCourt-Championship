import { Icon } from "../../components/Icon";
import { CANONICAL_USER_TASK, KOREAN_USER_TASK, replayTimeline } from "../../data/recordedRun";
import { PATCHCOURT_TARGET_URL, PUBLIC_REPLAY_ONLY } from "../../config";
import type { RunMode, VerifiedReceipt } from "../../types";

interface TrialDashboardProps {
  activeIndex: number;
  busy: boolean;
  mode: RunMode;
  liveEvents: Array<{ time: string; stage: string; message: string }>;
  notice: string;
  onReplay: () => void;
  onInspectRejection: () => void;
  onStart: () => void;
  receipt: VerifiedReceipt;
  receiptVerified?: boolean;
}

export function TrialDashboard({
  activeIndex,
  busy,
  mode,
  liveEvents,
  notice,
  onReplay,
  onInspectRejection,
  onStart,
  receipt,
  receiptVerified = true,
}: TrialDashboardProps) {
  const completedArtifacts = mode === "live" || !receiptVerified ? null : receipt.artifacts.length;
  const visibleTimeline = mode === "live"
    ? liveEvents
    : activeIndex < 0
      ? replayTimeline.slice(0, 1)
      : replayTimeline.slice(0, activeIndex + 1);

  return (
    <div className="trial-layout">
      <section className="trial-command" aria-labelledby="trial-heading">
        <header className="page-heading page-heading--trial">
          <h1 id="trial-heading">좋아졌다는 말 대신, 증거를 남깁니다.</h1>
          <p>같은 사용자 여정을 다시 실행하고, 회귀가 없을 때만 패치를 승격합니다.</p>
        </header>

        <div className="task-contract">
          <div className="contract-rule">
            <span>FROZEN TASK</span>
            <strong>PC01 · v1</strong>
          </div>
          <label htmlFor="target-url">검증할 주소</label>
          <div className="locked-field">
            <Icon name="lock" size={16} />
            <input id="target-url" readOnly value={PATCHCOURT_TARGET_URL} />
          </div>
          <label htmlFor="user-mission">사용자 미션</label>
          <textarea id="user-mission" readOnly rows={4} value={KOREAN_USER_TASK} />
          <details className="canonical-task">
            <summary>API에 전송되는 동결 원문</summary>
            <code>{CANONICAL_USER_TASK}</code>
          </details>
          <div className="command-actions">
            <button
              className={PUBLIC_REPLAY_ONLY ? "button button--secondary" : "button button--primary"}
              disabled={busy || PUBLIC_REPLAY_ONLY}
              type="button"
              onClick={onStart}
            >
              <Icon name="scale" />
              {PUBLIC_REPLAY_ONLY ? "라이브 API 연결 시 사용" : busy ? "재판 접수 중…" : "증거 재판 시작"}
            </button>
            <button
              className={PUBLIC_REPLAY_ONLY ? "button button--primary" : "button button--secondary"}
              type="button"
              onClick={onReplay}
            >
              <Icon name="play" />
              60초 데모 시나리오 압축 재생
            </button>
          </div>
          <button className="lineage-link" type="button" onClick={onInspectRejection}>
            <Icon name="receipt" size={15} /> 검증된 기각 계보 보기 · 인컴번트 유지 사례
          </button>
          <p className="run-notice" role="status" aria-live="polite">
            {notice}
          </p>
        </div>
      </section>

      <section className="live-docket" aria-labelledby="live-heading">
        <header className="live-docket__header">
          <div>
            <span>APPEND-ONLY LEDGER</span>
            <h2 id="live-heading">실시간 재판 기록</h2>
          </div>
          <div className="docket-counter">
            <strong>{completedArtifacts === null ? "—" : String(completedArtifacts).padStart(2, "0")}</strong>
            <span>{mode === "live" ? "수집 중" : "검증된 증거"}</span>
          </div>
        </header>
        <ol className="event-stream" aria-live="polite">
          {visibleTimeline.map((event, index) => (
            <li className={index === visibleTimeline.length - 1 ? "event-row event-row--active" : "event-row"} key={`${event.stage}-${event.time}-${index}`}>
              <time>{event.time}</time>
              <span className="event-index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{event.stage}</strong>
                <p>{event.message}</p>
              </div>
            </li>
          ))}
          {mode === "live" && visibleTimeline.length === 0 ? (
            <li className="event-row event-row--active">
              <time>LIVE</time><span className="event-index">··</span>
              <div><strong>이벤트 대기</strong><p>이 run에서 생성되는 named SSE evidence를 기다리고 있습니다.</p></div>
            </li>
          ) : null}
        </ol>
        <footer className="ledger-footer">
          <div>
            <span>실행 모드</span>
            <strong>{mode === "live" ? "LIVE API" : "RECORDED VERIFIED REPLAY"}</strong>
          </div>
          <div>
            <span>후보 임계 게이트</span>
            <strong>{mode === "live" ? "측정 중" : receiptVerified ? "13 / 13 PASS" : "검증 중"}</strong>
          </div>
          <div>
            <span>영수증 무결성</span>
            <strong>{mode === "live" ? "영수증 대기" : receiptVerified ? "SHA-256 BOUND" : "해시 검증 중"}</strong>
          </div>
        </footer>
      </section>
    </div>
  );
}
