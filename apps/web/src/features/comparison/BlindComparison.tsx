import { Icon } from "../../components/Icon";
import { StatusBadge } from "../../components/StatusBadge";
import { humanizeGate, judgeValidationSummary, shortHash } from "../../lib/format";
import { staticAssetUrl } from "../../lib/assets";
import { resolveArtifactUri } from "../../lib/runAdapter";
import type { RunMode, VerifiedReceipt } from "../../types";

interface BlindComparisonProps {
  receipt: VerifiedReceipt;
  revealed: boolean;
  mode: RunMode;
  onReveal: () => void;
}

export function BlindComparison({ receipt, revealed, mode, onReveal }: BlindComparisonProps) {
  const mapping = receipt.blindComparison.mappingReveal;
  const evaluationFor = (label: "A" | "B") => receipt.evaluations[mapping[label]];
  const imageFor = (label: "A" | "B") => {
    if (mode === "recorded") {
      const prefix = receipt.comparison.decision === "reject" ? "rejection-arm" : "arm";
      return staticAssetUrl(`evidence/${prefix}-${label.toLowerCase()}-profile.png`);
    }
    if (!revealed) return null;
    const artifact = receipt.artifacts.find(
      (item) =>
        item.variant === mapping[label] &&
        item.kind === "screenshot" &&
        item.stepId === "inspect" &&
        item.label.toLowerCase().includes("desktop"),
    );
    return artifact ? resolveArtifactUri(artifact.uri) : null;
  };
  const evaluationA = evaluationFor("A");
  const evaluationB = evaluationFor("B");
  const winner = receipt.blindComparison.winnerLabel;

  return (
    <div className="comparison-view">
      <header className="page-heading comparison-heading">
        <div>
          <h1>같은 여정에서 더 나은 쪽을 먼저 고릅니다.</h1>
          <p>소스 이름과 패치 이력을 숨긴 채, 동일한 과업 결과와 게이트만 비교합니다.</p>
        </div>
        <div className="blind-commitment">
          <Icon name="lock" size={16} />
          <span>{revealed ? "MAPPING REVEALED" : "ORDER COMMITTED"}</span>
          <code>
            {shortHash(
              revealed
                ? receipt.blindComparison.mappingReveal.nonce
                : receipt.blindComparison.orderCommitmentSha256,
            )}
          </code>
          {revealed ? (
            <small data-testid="revealed-order-commitment">
              order {shortHash(receipt.blindComparison.orderCommitmentSha256)}
            </small>
          ) : null}
          <small data-testid="judge-validation-summary">
            {judgeValidationSummary(receipt.blindComparison)}
          </small>
        </div>
      </header>

      <div className="variant-grid">
        {(["A", "B"] as const).map((label) => {
          const evaluation = evaluationFor(label);
          const isWinner = revealed && winner === label;
          const image = imageFor(label);
          return (
            <article className={isWinner ? "variant-sheet variant-sheet--winner" : "variant-sheet"} key={label}>
              <header>
                <div>
                  <span>ANONYMOUS ARM</span>
                  <h2>변종 {label}</h2>
                </div>
                {revealed ? (
                  <strong className={isWinner ? "reveal-label reveal-label--winner" : "reveal-label"}>
                    {mapping[label] === "candidate" ? "후보 패치" : "기존 버전"}
                  </strong>
                ) : (
                  <span className="sealed-label"><Icon name="lock" size={13} /> 정체 봉인</span>
                )}
              </header>
              <div className="variant-frame">
                {image ? (
                  <img alt={`익명 변종 ${label}의 John Smith 프로필 결과`} src={image} />
                ) : (
                  <div className="sealed-frame" role="img" aria-label={`익명 변종 ${label} 이미지 봉인`}>
                    <Icon name="lock" />
                    <span>LIVE ARM SEALED</span>
                  </div>
                )}
              </div>
              <footer>
                <div>
                  <span>관찰 점수</span>
                  <strong>{evaluation.score}</strong>
                </div>
                <div>
                  <span>판단 근거</span>
                  <strong>
                    {evaluation.metrics.decisionEvidenceCount} / {evaluation.metrics.decisionEvidenceTarget}
                  </strong>
                </div>
                <div>
                  <span>실패 게이트</span>
                  <strong>{evaluation.gates.filter((gate) => !gate.passed).length}</strong>
                </div>
              </footer>
            </article>
          );
        })}
      </div>

      <section className="gate-matrix" aria-labelledby="gate-heading">
        <header>
          <div>
            <span>DETERMINISTIC GATES</span>
            <h2 id="gate-heading">선호보다 먼저 확인한 13개 임계 계약</h2>
          </div>
          <button className="button button--reveal" type="button" onClick={onReveal}>
            {revealed ? <Icon name="check" /> : <Icon name="compare" />}
            {revealed
              ? winner
                ? `변종 ${winner} · ${mapping[winner] === "candidate" ? "후보 패치" : "기존 버전"}`
                : `블라인드 판정 ${receipt.blindComparison.status}`
              : "패치 정체 공개"}
          </button>
        </header>
        <div className="gate-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">임계 게이트</th>
                <th scope="col">변종 A</th>
                <th scope="col">변종 B</th>
                <th scope="col">관찰</th>
              </tr>
            </thead>
            <tbody>
              {evaluationB.gates.map((gateB) => {
                const gateA = evaluationA.gates.find((gate) => gate.id === gateB.id);
                return (
                  <tr key={gateB.id}>
                    <th scope="row">{humanizeGate(gateB.id)}</th>
                    <td><StatusBadge status={gateA?.passed ? "pass" : "fail"} /></td>
                    <td><StatusBadge status={gateB.passed ? "pass" : "fail"} /></td>
                    <td>{revealed ? gateB.observation : "관찰 원문은 정체 공개 후 표시"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
