import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { StatusBadge } from "../../components/StatusBadge";
import { formatIssuedAt, humanizeGate, judgeValidationSummary, shortHash } from "../../lib/format";
import { downloadReceipt } from "../../lib/runAdapter";
import type { RunMode, VerifiedReceipt } from "../../types";

interface ChampionReceiptProps {
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

export function ChampionReceipt({ mode, onRetry, receipt }: ChampionReceiptProps) {
  const [copied, setCopied] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const candidateGates = receipt.evaluations.candidate.gates;
  const passedCount = candidateGates.filter((gate) => gate.passed).length;
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
      <article className="champion-receipt" aria-labelledby="receipt-heading">
        <header className="receipt-hero">
          <div className="champion-seal" aria-hidden="true"><Icon name="check" size={34} /></div>
          <div>
            <span>PATCHCOURT · VERIFIED PROMOTION</span>
            <h1 id="receipt-heading" ref={headingRef} tabIndex={-1}>CHAMPION</h1>
            <p>이 패치는 같은 여정을 통과했고, 새로운 회귀를 만들지 않았습니다.</p>
          </div>
          <div className="receipt-score">
            <span>OBSERVED OUTCOME</span>
            <strong>{receipt.evaluations.incumbent.score} → {receipt.evaluations.candidate.score}</strong>
            <small>실제 PC01 리플레이</small>
          </div>
        </header>

        <section className="receipt-summary" aria-label="판결 요약">
          <div><span>MISSION</span><strong>PC01 · creator discovery to safe offer draft</strong></div>
          <div><span>VERDICT</span><strong>후보 패치 승격</strong></div>
          <div><span>CRITICAL GATES</span><strong>{passedCount} / {candidateGates.length} 통과</strong></div>
          <div><span>BLIND WINNER</span><strong>변종 {receipt.blindComparison.winnerLabel ?? "-"}</strong></div>
        </section>

        <div className="execution-provenance" data-testid="execution-provenance">
          <span>EXECUTION PROVENANCE</span>
          <strong>{executionLabel}</strong>
          <small>
            critic {receipt.execution?.criticProvider ?? "deterministic-reference"} · patch {receipt.execution?.patchProvider ?? "deterministic-reference"} · judge {receipt.execution?.judgeProvider ?? "deterministic-reference"}
          </small>
          <small>critic 제안 {criticTotals.proposed} · 채택 {criticTotals.accepted} · 기각 {criticTotals.rejected}</small>
          <small data-testid="judge-validation-summary">{judgeValidationSummary(receipt.blindComparison)}</small>
        </div>

        <section className="receipt-gates" aria-labelledby="receipt-gates-heading">
          <header>
            <span>DETERMINISTIC RECORD</span>
            <h2 id="receipt-gates-heading">모든 임계 계약이 증거에 묶였습니다.</h2>
          </header>
          <div className="receipt-gate-list">
            {candidateGates.map((gate, index) => (
              <div key={gate.id}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{humanizeGate(gate.id)}</strong>
                <StatusBadge status={gate.passed ? "pass" : "fail"} />
              </div>
            ))}
          </div>
        </section>

        <section className="receipt-lineage" aria-label="영수증 계보와 해시">
          <div><span>RECEIPT ID</span><code>{receipt.receiptId}</code></div>
          <div><span>TASK FINGERPRINT</span><code title={receipt.taskFingerprint}>{shortHash(receipt.taskFingerprint, 16, 12)}</code></div>
          <div><span>INCUMBENT SOURCE</span><code title={receipt.source.incumbentSha256}>{shortHash(receipt.source.incumbentSha256, 16, 12)}</code></div>
          <div><span>CANDIDATE SOURCE</span><code title={receipt.source.candidateSha256}>{shortHash(receipt.source.candidateSha256, 16, 12)}</code></div>
          <div><span>PATCH DIGEST</span><code title={receipt.source.patchSha256}>{shortHash(receipt.source.patchSha256, 16, 12)}</code></div>
          <div><span>FACTS PACKET</span><code title={receipt.source.factsSha256}>{shortHash(receipt.source.factsSha256, 16, 12)}</code></div>
          <div><span>CRITIC PROVENANCE</span><code title={receipt.criticProvenance?.digest}>{shortHash(receipt.criticProvenance?.digest ?? "측정 대기", 16, 12)}</code></div>
          <div><span>ACCEPTED CRITICS</span><code title={receipt.criticProvenance?.acceptedCriticIdsDigest}>{shortHash(receipt.criticProvenance?.acceptedCriticIdsDigest ?? "측정 대기", 16, 12)}</code></div>
          <div><span>JUDGE VALIDATION</span><code title={receipt.blindComparison.validationRepair.digest}>{shortHash(receipt.blindComparison.validationRepair.digest, 16, 12)}</code></div>
          <div className="ledger-head"><span>PAYLOAD SHA-256</span><code>{receipt.integrity.payloadSha256}</code></div>
        </section>

        <footer className="receipt-footer">
          <div>
            <span>ISSUED AT</span>
            <strong>{formatIssuedAt(receipt.createdAt)}</strong>
            <small>{receipt.integrity.algorithm}</small>
          </div>
          <div className="receipt-actions">
            <button className="button button--secondary" type="button" onClick={handleCopy}>
              {copied ? <Icon name="check" /> : <Icon name="copy" />}
              {copied ? "복사 완료" : "영수증 복사"}
            </button>
            <button className="button button--secondary" type="button" onClick={() => downloadReceipt(receipt)}>
              <Icon name="download" /> JSON 내려받기
            </button>
            <button className="button button--primary" type="button" onClick={onRetry}>
              <Icon name="replay" /> 다시 재판하기
            </button>
          </div>
          <p className="copy-status" role="status" aria-live="polite">
            {copied ? "정규화된 영수증 JSON을 클립보드에 복사했습니다." : ""}
          </p>
        </footer>
      </article>
    </div>
  );
}
