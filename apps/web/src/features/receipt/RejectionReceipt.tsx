import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { StatusBadge } from "../../components/StatusBadge";
import { formatIssuedAt, humanizeGate, judgeValidationSummary, shortHash } from "../../lib/format";
import { downloadReceipt } from "../../lib/runAdapter";
import type { RunMode, VerifiedReceipt } from "../../types";

interface RejectionReceiptProps {
  mode: RunMode;
  onRetry: () => void;
  receipt: VerifiedReceipt;
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.style.position = "fixed";
  textArea.style.opacity = "0";
  document.body.append(textArea);
  textArea.select();
  document.execCommand("copy");
  textArea.remove();
}

export function RejectionReceipt({ mode, onRetry, receipt }: RejectionReceiptProps) {
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const failedGates = receipt.evaluations.candidate.gates.filter(
    (gate) => gate.critical && !gate.passed,
  );
  const shortCircuited =
    receipt.blindComparison.status === "invalid" && receipt.blindComparison.invocationCount === 0;
  const executionLabel = mode === "live"
    ? receipt.execution?.mode === "live-gemini"
      ? `LIVE GEMINI · ${receipt.execution.model}`
      : "LIVE API · OFFLINE-DEMO REFERENCE"
    : "VERIFIED REPLAY · deterministic reference";
  const criticTotals = (receipt.criticProvenance?.entries ?? []).reduce(
    (totals, entry) => ({
      proposed: totals.proposed + entry.proposedCount,
      accepted: totals.accepted + entry.acceptedCount,
      rejected: totals.rejected + entry.rejectedCount,
    }),
    { proposed: 0, accepted: 0, rejected: 0 },
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function handleCopy() {
    await copyText(JSON.stringify(receipt, null, 2));
    setCopied(true);
  }

  return (
    <div className="receipt-view">
      <article className="rejection-receipt" aria-labelledby="rejection-heading">
        <p className="sr-only" role="status">
          기각 영수증을 열었습니다. 후보 패치가 기각되었으며 기존 버전이 유지됩니다.
        </p>
        <header className="rejection-hero">
          <div className="rejection-seal" aria-hidden="true"><Icon name="x" size={30} /></div>
          <div>
            <span>PATCHCOURT · VERIFIED REJECTION</span>
            <h1 id="rejection-heading" ref={headingRef} tabIndex={-1}>패치 심의 결과: 기각 <small>(Candidate Rejected)</small></h1>
            <p>후보 패치가 기각되었으며, 기존 버전(Incumbent)이 유지됩니다.</p>
          </div>
          <strong className="rejection-badge">REJECTED / INCUMBENT RETAINED</strong>
        </header>

        <section className="receipt-summary" aria-label="기각 판결 요약">
          <div><span>RECEIPT ID</span><strong>{receipt.receiptId}</strong></div>
          <div><span>DECISION</span><strong>reject</strong></div>
          <div><span>RETAINED TARGET</span><strong>incumbent</strong></div>
          <div><span>FAILED CRITICAL</span><strong>{failedGates.length}</strong></div>
        </section>

        <section className="rejection-failures" aria-labelledby="failed-gates-heading">
          <header>
            <span>FAILED CRITICAL GATES</span>
            <h2 id="failed-gates-heading">결정적 안전 계약을 통과하지 못했습니다.</h2>
          </header>
          <div className="failed-gate-list">
            {failedGates.map((gate) => (
              <div key={gate.id}>
                <div><code>{gate.id}</code><StatusBadge status="fail" /></div>
                <strong>{humanizeGate(gate.id)}</strong>
                <p>{gate.observation}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="blind-short-circuit" aria-label="블라인드 판정 실행 상태">
          <div>
            <span>BLIND COMPARISON · {receipt.blindComparison.status.toUpperCase()}</span>
            <strong>
              {shortCircuited
                ? "결정적 안전 게이트 검증 실패로 모델 판정을 호출하지 않았습니다."
                : "블라인드 판정 결과가 승격 조건을 충족하지 못했습니다."}
            </strong>
            <p>
              {shortCircuited
                ? "모델 판정(Model Judge)이 호출되지 않고 조기 종료(Short-circuit)되었습니다."
                : `공개 결과: ${receipt.blindComparison.revealedWinner}`}
            </p>
          </div>
          <dl>
            <div><dt>INVOCATION COUNT</dt><dd>{receipt.blindComparison.invocationCount}</dd></div>
            <div><dt>VALIDATION REPAIR</dt><dd>{judgeValidationSummary(receipt.blindComparison)}</dd></div>
            <div><dt>INVALID REASON</dt><dd><code>{receipt.blindComparison.invalidReason ?? "—"}</code></dd></div>
          </dl>
        </section>

        <section className="receipt-lineage" aria-label="기각 영수증 계보와 해시">
          <div><span>TASK FINGERPRINT</span><code title={receipt.taskFingerprint}>{shortHash(receipt.taskFingerprint, 16, 12)}</code></div>
          <div><span>INCUMBENT SHA-256</span><code title={receipt.source.incumbentSha256}>{shortHash(receipt.source.incumbentSha256, 16, 12)}</code></div>
          <div><span>CANDIDATE SHA-256</span><code title={receipt.source.candidateSha256}>{shortHash(receipt.source.candidateSha256, 16, 12)}</code></div>
          <div><span>PATCH SHA-256</span><code title={receipt.source.patchSha256}>{shortHash(receipt.source.patchSha256, 16, 12)}</code></div>
          <div><span>FACTS SHA-256</span><code title={receipt.source.factsSha256}>{shortHash(receipt.source.factsSha256, 16, 12)}</code></div>
          <div><span>EXECUTION PROVENANCE</span><code>{executionLabel}</code></div>
          <div><span>CRITIC PROVENANCE</span><code title={receipt.criticProvenance?.digest}>{shortHash(receipt.criticProvenance?.digest ?? "측정 대기", 16, 12)}</code></div>
          <div><span>CRITIC SELECTION</span><code>제안 {criticTotals.proposed} · 채택 {criticTotals.accepted} · 기각 {criticTotals.rejected}</code></div>
          <div><span>ACCEPTED CRITICS</span><code title={receipt.criticProvenance?.acceptedCriticIdsDigest}>{shortHash(receipt.criticProvenance?.acceptedCriticIdsDigest ?? "측정 대기", 16, 12)}</code></div>
          <div><span>JUDGE VALIDATION</span><code title={receipt.blindComparison.validationRepair.digest}>{shortHash(receipt.blindComparison.validationRepair.digest, 16, 12)}</code></div>
          <div className="ledger-head"><span>PAYLOAD SHA-256</span><code>{receipt.integrity.payloadSha256}</code></div>
        </section>

        <footer className="receipt-footer rejection-footer">
          <div>
            <span>ISSUED AT</span>
            <strong>{formatIssuedAt(receipt.createdAt)}</strong>
            <small>{receipt.integrity.algorithm}</small>
          </div>
          <div className="receipt-actions">
            <button className="button button--secondary" type="button" onClick={handleCopy}>
              {copied ? <Icon name="check" /> : <Icon name="copy" />}
              {copied ? "복사 완료" : "복사 (Copy Receipt JSON)"}
            </button>
            <button className="button button--primary" type="button" onClick={() => downloadReceipt(receipt)}>
              <Icon name="download" /> 다운로드 (Download Receipt)
            </button>
            <button className="button rejection-retry" type="button" onClick={onRetry}>
              <Icon name="replay" /> 재시도 (Retry Run)
            </button>
          </div>
          <p className="copy-status" role="status" aria-live="polite">
            {copied ? "정규화된 기각 영수증 JSON을 클립보드에 복사했습니다." : ""}
          </p>
        </footer>
      </article>
    </div>
  );
}
