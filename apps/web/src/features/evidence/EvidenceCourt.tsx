import { useState } from "react";
import { Icon } from "../../components/Icon";
import { findingEvidence } from "../../data/recordedRun";
import { humanizeGate } from "../../lib/format";
import { resolveArtifactUri } from "../../lib/runAdapter";
import type { RunMode, VerifiedReceipt } from "../../types";

interface EvidenceItem {
  id: string;
  title: string;
  detail: string;
  gateId: string;
  pin: { x: number; y: number };
}

export function EvidenceCourt({ receipt, mode }: { receipt: VerifiedReceipt; mode: RunMode }) {
  const liveFailures: EvidenceItem[] = receipt.evaluations.incumbent.gates
    .filter((gate) => !gate.passed)
    .slice(0, 3)
    .map((gate, index) => ({
      id: `L-${String(index + 1).padStart(2, "0")}`,
      title: humanizeGate(gate.id),
      detail: gate.observation,
      gateId: gate.id,
      pin: [
        { x: 58, y: 58 },
        { x: 70, y: 73 },
        { x: 84, y: 86 },
      ][index],
    }));
  const evidenceItems: readonly EvidenceItem[] =
    mode === "live" ? liveFailures : findingEvidence;
  const [selectedId, setSelectedId] = useState(mode === "live" ? "L-01" : "E-01");
  const selected = evidenceItems.find((item) => item.id === selectedId) ?? evidenceItems[0] ?? null;
  const failedIncumbentGates = receipt.evaluations.incumbent.gates.filter((gate) => !gate.passed);
  const criticEntries = receipt.criticProvenance?.entries ?? [];
  const criticTotals = criticEntries.reduce(
    (totals, entry) => ({
      proposed: totals.proposed + entry.proposedCount,
      accepted: totals.accepted + entry.acceptedCount,
      rejected: totals.rejected + entry.rejectedCount,
    }),
    { proposed: 0, accepted: 0, rejected: 0 },
  );
  const criticRole =
    receipt.execution?.mode === "live-gemini" ? "Gemini 3.6 Flash 비평" : "결정론적 지표 비평";
  const criticProvider = receipt.execution?.criticProvider ?? "deterministic-reference";
  const selectedGate = selected
    ? receipt.evaluations.incumbent.gates.find((gate) => gate.id === selected.gateId)
    : null;
  const profileArtifact = receipt.artifacts.find(
    (artifact) =>
      artifact.variant === "incumbent" &&
      artifact.kind === "screenshot" &&
      artifact.stepId === "inspect" &&
      artifact.label.toLowerCase().includes("desktop"),
  );
  const profileImage = profileArtifact ? resolveArtifactUri(profileArtifact.uri) : null;

  return (
    <div className="court-view">
      <header className="page-heading page-heading--court">
        <div>
          <h1>결함은 주장으로 채택되기 전에 증명되어야 합니다.</h1>
          <p>브라우저에서 캡처하고 해시한 관찰값만 판결 기록에 들어갑니다.</p>
        </div>
        <div className="verdict-strip">
          <span>INCUMBENT VERDICT</span>
          <strong>
            {failedIncumbentGates.length}개 임계 게이트 실패 · {failedIncumbentGates.slice(0, 3).map((gate) => humanizeGate(gate.id)).join(" · ")}
          </strong>
          <small>{criticRole} · {criticProvider}</small>
          <small>제안 {criticTotals.proposed} · 채택 {criticTotals.accepted} · 기각 {criticTotals.rejected}</small>
        </div>
      </header>

      <div className="court-grid">
        <section className="frame-inspector" aria-label="실패 화면 증거">
          <div className="browser-chrome">
            <div aria-hidden="true"><span /><span /><span /></div>
            <code>owned://pc01/incumbent/john-smith</code>
            <span>1280 × 720</span>
          </div>
          <div className="evidence-frame">
            {profileImage ? (
              <img alt="인컴번트 John Smith 프로필 브라우저 증거" src={profileImage} />
            ) : (
              <div className="evidence-placeholder" role="img" aria-label="프로필 증거 이미지 대기 중">
                봉인된 프로필 증거를 불러오는 중
              </div>
            )}
            {evidenceItems.map((item) => (
              <button
                aria-label={`${item.id}: ${item.title}`}
                aria-pressed={selectedId === item.id}
                className="evidence-pin"
                key={item.id}
                style={{ left: `${item.pin.x}%`, top: `${item.pin.y}%` }}
                type="button"
                onClick={() => setSelectedId(item.id)}
              >
                {item.id.slice(-2)}
              </button>
            ))}
          </div>
          <div className="evidence-caption">
            <span>{selected?.id ?? "L-00"}</span>
            <div>
              <strong>{selected?.title ?? "이 live receipt에 실패한 인컴번트 게이트가 없습니다."}</strong>
              <p>{selected?.detail ?? "저장된 리플레이의 결함을 대신 표시하지 않습니다."}</p>
            </div>
            <code>{selectedGate?.artifactIds?.at(0) ?? "artifact pending"}</code>
          </div>
        </section>

        <aside className="argument-docket" aria-label="증거 변론과 판결">
          <div className="docket-title">
            <span>DOCKET · PC01-F03</span>
            <strong>증거 기반 변론</strong>
          </div>
          <section className="argument argument--prosecution">
            <header>
              <span className="role-mark">P</span>
              <div><strong>{criticRole}</strong><span>{criticProvider}</span></div>
            </header>
            <p>{selected?.detail ?? "이 run에서 채택된 실패 관찰이 없습니다."}</p>
            {selected ? (
              <button type="button" onClick={() => setSelectedId(selected.id)}>
                {selected.id} 원문 보기 <Icon name="external" size={14} />
              </button>
            ) : null}
          </section>
          <section className="argument argument--defense">
            <header>
              <span className="role-mark">D</span>
              <div><strong>범위 반론</strong><span>보호 행동 설명</span></div>
            </header>
            <p>
              로그인·검색·초안 편집은 동작합니다. 하지만 완수 가능성이 결함의 개인정보·판단 품질·반응형 실패를 상쇄하지는 않습니다.
            </p>
            <span className="citation">보호 행동: login · search · editable draft</span>
          </section>
          <section className="argument argument--judge">
            <header>
              <span className="role-mark">J</span>
              <div><strong>판결 엔진</strong><span>원자적 채택</span></div>
            </header>
            <p>
              {selectedGate?.observation ?? "관찰값을 불러오는 중입니다."} 이 관찰은 재현 가능하고 임계 게이트에 직접 연결되므로 패치 브리프에 채택합니다.
            </p>
            <div className="judge-rule">
              <span>ACCEPTANCE</span>
              <strong>{selected?.gateId ?? "no_failed_gate"}</strong>
            </div>
          </section>
          <nav className="evidence-index" aria-label="증거 선택">
            {evidenceItems.map((item) => (
              <button
                aria-current={selectedId === item.id ? "true" : undefined}
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
              >
                <span>{item.id}</span>
                <strong>{item.title}</strong>
              </button>
            ))}
          </nav>
        </aside>
      </div>
    </div>
  );
}
