import { useEffect, useRef } from "react";
import { Icon } from "../../components/Icon";
import type { InvalidRunSummary } from "../../types";

interface InvalidRunReportProps {
  onReplay: () => void;
  onRetry: () => void;
  run: InvalidRunSummary;
}

export function InvalidRunReport({ onReplay, onRetry, run }: InvalidRunReportProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const execution = run.execution
    ? run.execution.mode === "live-gemini"
      ? `LIVE GEMINI · ${run.execution.model ?? "provider model unavailable"}`
      : "OFFLINE DEMO · deterministic reference"
    : "EXECUTION PROVENANCE UNAVAILABLE";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="receipt-view">
      <article className="invalid-run-report" aria-labelledby="invalid-heading" role="alert">
        <header className="invalid-run-hero">
          <div className="invalid-mark" aria-hidden="true"><Icon name="x" size={28} /></div>
          <div>
            <span>PATCHCOURT · NON-VERDICT TERMINAL RECORD</span>
            <h1 id="invalid-heading" ref={headingRef} tabIndex={-1}>판결불가 및 실행 무효 리포트</h1>
            <p>제공자 및 인프라 오류로 인해 평가가 완료되지 않았습니다. 현행 모델 상태가 유지됩니다.</p>
          </div>
          <strong>실행 무효 (INVALID)</strong>
        </header>

        <section className="invalid-truth" aria-label="실행 무효 사실">
          <div><span>실행 판결</span><strong>판결 불가 (무효 종료)</strong></div>
          <div><span>인컴번트 영향</span><strong>변경 없음 · 승격/기각 미발생</strong></div>
          <div><span>비교 단계</span><strong>블라인드 비교 및 승격 미실행</strong></div>
        </section>

        <section className="invalid-docket" aria-label="실행 무효 기록">
          <div><span>RUN ID</span><code>{run.runId}</code></div>
          <div><span>INTERNAL TERMINAL RECEIPT</span><code>{run.receiptId ?? "발급되지 않음"}</code></div>
          <div><span>STATUS</span><code>invalid</code></div>
          <div><span>FAILURE CODE</span><code>{run.failure?.code ?? "unknown_failure"}</code></div>
          <div><span>FAILED STAGE</span><code>{run.failure?.stage ?? "unknown_stage"}</code></div>
          <div><span>EXECUTION</span><code>{execution}</code></div>
          <div className="invalid-message"><span>SANITIZED FAILURE</span><p>{run.failure?.message ?? "실행 제공자 오류로 평가가 완료되지 않았습니다."}</p></div>
        </section>

        <aside className="invalid-boundary">
          <Icon name="lock" />
          <p>이 기록은 정식 승격·기각 영수증이 아닙니다. 다른 run의 점수, 게이트, 증거, A/B 결과를 대신 표시하지 않습니다.</p>
        </aside>

        <footer className="invalid-actions">
          <button className="button button--primary" type="button" onClick={onRetry}>
            <Icon name="replay" /> 로컬 재시도
          </button>
          <button className="button button--secondary" type="button" onClick={onReplay}>
            <Icon name="play" /> 검증된 리플레이로 이동
          </button>
        </footer>
      </article>
    </div>
  );
}
