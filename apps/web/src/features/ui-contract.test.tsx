import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "../components/AppShell";
import { RunRail } from "../components/RunRail";
import { recordedReceipt, recordedRejectionReceipt } from "../data/recordedRun";
import { BlindComparison } from "./comparison/BlindComparison";
import { EvidenceCourt } from "./evidence/EvidenceCourt";
import { LivePending } from "./live/LivePending";
import { ChampionReceipt } from "./receipt/ChampionReceipt";
import { RejectionReceipt } from "./receipt/RejectionReceipt";
import { TrialDashboard } from "./trial/TrialDashboard";

describe("truth-bound UI states", () => {
  it("keeps anonymous arm identity out of pre-reveal asset URLs and accessible text", () => {
    const { container } = render(
      <BlindComparison
        mode="recorded"
        onReveal={vi.fn()}
        receipt={recordedReceipt}
        revealed={false}
      />,
    );
    const imageSources = [...container.querySelectorAll("img")].map((image) => image.getAttribute("src"));
    expect(imageSources).toHaveLength(2);
    expect(imageSources.join(" ")).not.toMatch(/incumbent|candidate/iu);
    expect(container.textContent).not.toMatch(/incumbent|candidate/iu);
    expect(screen.getByText("ORDER COMMITTED").parentElement).toHaveTextContent(
      recordedReceipt.blindComparison.orderCommitmentSha256.slice(0, 10),
    );
  });

  it("does not attach recorded arm images to an unrevealed live receipt", () => {
    const receiptWithIdentityBearingObservation = structuredClone(recordedReceipt);
    receiptWithIdentityBearingObservation.evaluations.candidate.gates[0].observation =
      "candidate passed while incumbent failed";
    const { container } = render(
      <BlindComparison
        mode="live"
        onReveal={vi.fn()}
        receipt={receiptWithIdentityBearingObservation}
        revealed={false}
      />,
    );
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getAllByText("LIVE ARM SEALED")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/incumbent|candidate/iu);
    expect(screen.getAllByText("관찰 원문은 정체 공개 후 표시")).toHaveLength(13);
  });

  it("reveals mapping only after the explicit control is used", () => {
    function Harness() {
      const [revealed, setRevealed] = useState(false);
      return (
        <BlindComparison
          mode="recorded"
          onReveal={() => setRevealed(true)}
          receipt={recordedReceipt}
          revealed={revealed}
        />
      );
    }
    render(<Harness />);
    expect(screen.queryByText("MAPPING REVEALED")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "패치 정체 공개" }));
    expect(screen.getByText("MAPPING REVEALED").parentElement).toHaveTextContent(
      recordedReceipt.blindComparison.mappingReveal.nonce.slice(0, 10),
    );
    expect(screen.getByTestId("revealed-order-commitment")).toHaveTextContent(
      recordedReceipt.blindComparison.orderCommitmentSha256.slice(0, 10),
    );
    expect(screen.getByText("후보 패치")).toBeInTheDocument();
    expect(screen.getByText("기존 버전")).toBeInTheDocument();
  });

  it("renders facts and execution provenance in the promotion receipt", () => {
    render(<ChampionReceipt mode="recorded" onRetry={vi.fn()} receipt={recordedReceipt} />);
    const lineage = screen.getByLabelText("영수증 계보와 해시");
    expect(within(lineage).getByText("FACTS PACKET")).toBeInTheDocument();
    expect(within(lineage).getByTitle(recordedReceipt.source.factsSha256)).toHaveTextContent(
      recordedReceipt.source.factsSha256.slice(0, 16),
    );
    expect(screen.getByTestId("execution-provenance")).toHaveTextContent(
      "VERIFIED REPLAY · deterministic reference",
    );
    expect(within(lineage).getByText("CRITIC PROVENANCE")).toBeInTheDocument();
    expect(within(lineage).getByTitle(recordedReceipt.criticProvenance.digest)).toHaveTextContent(
      recordedReceipt.criticProvenance.digest.slice(0, 16),
    );
    expect(screen.getByTestId("judge-validation-summary")).toHaveTextContent(
      "DIRECT VALIDATION · 1 CALL · NO REPAIR",
    );
    expect(within(lineage).getByText("JUDGE VALIDATION")).toBeInTheDocument();
  });

  it("labels a just-executed offline-demo receipt as live API output, not stored replay", () => {
    render(<ChampionReceipt mode="live" onRetry={vi.fn()} receipt={recordedReceipt} />);
    expect(screen.getByTestId("execution-provenance")).toHaveTextContent(
      "LIVE API · OFFLINE-DEMO REFERENCE",
    );
    expect(screen.getByTestId("execution-provenance")).not.toHaveTextContent("VERIFIED REPLAY");
  });

  it("renders a retained-incumbent rejection with the failed gate and short circuit", () => {
    render(
      <RejectionReceipt mode="recorded" onRetry={vi.fn()} receipt={recordedRejectionReceipt} />,
    );
    expect(screen.getByRole("heading", { name: /패치 심의 결과: 기각/u })).toBeInTheDocument();
    expect(screen.getByText("REJECTED / INCUMBENT RETAINED")).toBeInTheDocument();
    expect(screen.getByText("responsive_primary_action")).toBeInTheDocument();
    expect(screen.getByText("INVOCATION COUNT").parentElement).toHaveTextContent("0");
    expect(screen.getByText("INVALID REASON").parentElement).toHaveTextContent(
      "not_called:critical_gate_failed:responsive_primary_action",
    );
    expect(screen.getByText("FACTS SHA-256")).toBeInTheDocument();
    expect(screen.getByText("EXECUTION PROVENANCE").parentElement).toHaveTextContent(
      "VERIFIED REPLAY · deterministic reference",
    );
    expect(screen.getByText("CRITIC SELECTION").parentElement).toHaveTextContent(/제안 \d+ · 채택 \d+ · 기각 \d+/u);
    expect(screen.getByText("VALIDATION REPAIR").parentElement).toHaveTextContent(
      "PRE-GATE SHORT CIRCUIT · 0 CALLS · NO REPAIR",
    );
  });

  it("labels deterministic replay critics honestly and exposes selection counts", () => {
    render(<EvidenceCourt mode="recorded" receipt={recordedReceipt} />);
    expect(screen.getAllByText("결정론적 지표 비평").length).toBeGreaterThan(0);
    expect(screen.queryByText("검사 AI")).not.toBeInTheDocument();
    expect(screen.getByText(/제안 \d+ · 채택 \d+ · 기각 \d+/u)).toBeInTheDocument();
    expect(screen.getAllByText(recordedReceipt.execution.criticProvider).length).toBeGreaterThan(0);
  });

  it("never substitutes recorded findings when a live receipt has no incumbent failures", () => {
    const noFailureReceipt = structuredClone(recordedReceipt);
    noFailureReceipt.evaluations.incumbent.gates.forEach((gate) => {
      gate.passed = true;
    });
    render(<EvidenceCourt mode="live" receipt={noFailureReceipt} />);
    expect(
      screen.getByText("이 live receipt에 실패한 인컴번트 게이트가 없습니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("저장된 리플레이의 결함을 대신 표시하지 않습니다.")).toBeInTheDocument();
    expect(screen.queryByText("의사결정 근거 0 / 4")).not.toBeInTheDocument();
    expect(screen.queryByText("변호 AI")).not.toBeInTheDocument();
  });

  it("never invents an A/B winner for an invalid rejection comparison", () => {
    const { container } = render(
      <BlindComparison
        mode="recorded"
        onReveal={vi.fn()}
        receipt={recordedRejectionReceipt}
        revealed
      />,
    );
    expect(screen.getByRole("button", { name: "블라인드 판정 invalid" })).toBeInTheDocument();
    expect(container.querySelector(".variant-sheet--winner")).toBeNull();
  });

  it("hides recorded artifacts, scores, and gates while a live docket is pending", () => {
    const { rerender } = render(
      <TrialDashboard
        activeIndex={2}
        busy={false}
        liveEvents={[]}
        mode="live"
        notice="실시간 이벤트 대기"
        onInspectRejection={vi.fn()}
        onReplay={vi.fn()}
        onStart={vi.fn()}
        receipt={recordedReceipt}
      />,
    );
    expect(screen.queryByText("13 / 13 PASS")).not.toBeInTheDocument();
    expect(screen.queryByText(String(recordedReceipt.artifacts.length).padStart(2, "0"))).not.toBeInTheDocument();
    expect(screen.getByText("측정 중")).toBeInTheDocument();

    rerender(
      <LivePending
        activeIndex={4}
        events={[]}
        notice="블라인드 판정 대기"
        view="comparison"
      />,
    );
    expect(screen.getByText(/저장된 리플레이의 점수·결함·변종은 섞지 않습니다/u)).toBeInTheDocument();
    expect(screen.queryByText("13 / 13 PASS")).not.toBeInTheDocument();
  });
});

describe("mobile navigation and run rail semantics", () => {
  it("exposes stable nav labels, current view, progress value, and current step", () => {
    const onViewChange = vi.fn();
    render(
      <AppShell
        activeIndex={3}
        mode="recorded"
        onViewChange={onViewChange}
        receiptId={recordedReceipt.receiptId}
        view="evidence"
      >
        <p>content</p>
      </AppShell>,
    );
    const navigation = screen.getByRole("navigation", { name: "주요 화면" });
    for (const label of ["재판", "증거", "비교", "영수증"]) {
      expect(within(navigation).getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(within(navigation).getByRole("button", { name: "증거" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(within(navigation).getByRole("button", { name: "비교" }));
    expect(onViewChange).toHaveBeenCalledWith("comparison");
    const progress = screen.getByRole("progressbar", { name: "재판 진행 단계" });
    expect(progress).toHaveAttribute("aria-valuenow", "4");
    expect(progress).toHaveAttribute("aria-valuetext", "4 / 6 단계 · 패치");
    expect(progress.querySelector(".run-step--active")).toHaveAttribute("aria-current", "step");
  });

  it("keeps the rail component valid at the initial ready state", () => {
    const { container } = render(<RunRail activeIndex={-1} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(container.querySelector(".run-step__label")?.closest("li")).toHaveClass("run-step--ready");
  });
});
