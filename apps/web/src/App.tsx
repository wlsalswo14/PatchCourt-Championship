import { useCallback, useEffect, useRef, useState } from "react";
import { AppShell } from "./components/AppShell";
import { recordedReceipt, recordedRejectionReceipt, replayTimeline } from "./data/recordedRun";
import { BlindComparison } from "./features/comparison/BlindComparison";
import { EvidenceCourt } from "./features/evidence/EvidenceCourt";
import { LivePending } from "./features/live/LivePending";
import { ChampionReceipt } from "./features/receipt/ChampionReceipt";
import { InvalidRunReport } from "./features/receipt/InvalidRunReport";
import { RejectionReceipt } from "./features/receipt/RejectionReceipt";
import { TrialDashboard } from "./features/trial/TrialDashboard";
import {
  createLiveRun,
  fetchInvalidRunSummary,
  fetchRunReceipt,
  loadPreferredReceipt,
  subscribeToRun,
  verifyReceipt,
} from "./lib/runAdapter";
import type { InvalidRunSummary, RunMode, VerifiedReceipt, ViewName } from "./types";

const STATUS_TO_STAGE: Record<string, number> = {
  created: 0,
  snapshotting: 0,
  observing_incumbent: 1,
  criticizing: 2,
  compiling_feedback: 2,
  patching_candidate: 3,
  observing_candidate: 4,
  deterministic_gates: 4,
  blind_comparison: 4,
  promoted: 5,
  rejected: 5,
  invalid: 5,
};

const VIEW_AT_STAGE: Partial<Record<number, ViewName>> = {
  2: "evidence",
  4: "comparison",
  5: "receipt",
};

export default function App() {
  const [view, setView] = useState<ViewName>("trial");
  const [mode, setMode] = useState<RunMode>("recorded");
  const [receipt, setReceipt] = useState<VerifiedReceipt>(recordedReceipt);
  const [receiptVerified, setReceiptVerified] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [liveReceiptReady, setLiveReceiptReady] = useState(false);
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [invalidRun, setInvalidRun] = useState<InvalidRunSummary | null>(null);
  const [liveEvents, setLiveEvents] = useState<Array<{ time: string; stage: string; message: string }>>([]);
  const [notice, setNotice] = useState(
    "검증된 PC01 영수증이 준비되어 있습니다. 실시간 실행 또는 60초 리플레이를 시작하세요.",
  );
  const timersRef = useRef<number[]>([]);
  const closeStreamRef = useRef<null | (() => void)>(null);
  const modeRef = useRef<RunMode>("recorded");
  const preferredReceiptRef = useRef<VerifiedReceipt>(recordedReceipt);
  const preferredVerifiedRef = useRef(false);

  const clearPlayback = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current = [];
  }, []);

  useEffect(() => {
    let current = true;
    loadPreferredReceipt()
      .then(({ receipt: preferred, source }) => {
        if (!current) return;
        preferredReceiptRef.current = preferred;
        preferredVerifiedRef.current = true;
        if (modeRef.current !== "recorded") return;
        setReceipt(preferred);
        setReceiptVerified(true);
        setNotice(
          source === "public-recorded"
            ? "공개 데모: 네트워크 요청 없이 CI-검증 PC01 리플레이를 사용합니다."
            : "네트워크 요청 없이 저장된 해시 검증 PC01 리플레이를 준비했습니다.",
        );
      })
      .catch(() => {
        if (current && modeRef.current === "recorded") {
          setNotice("저장된 PC01 영수증의 무결성을 검증하지 못해 결과 화면을 잠갔습니다.");
        }
      });
    return () => {
      current = false;
      clearPlayback();
      closeStreamRef.current?.();
    };
  }, [clearPlayback]);

  const startReplay = useCallback(() => {
    if (!preferredVerifiedRef.current) {
      setNotice("영수증 무결성 검증이 끝난 뒤 리플레이를 시작할 수 있습니다.");
      return;
    }
    clearPlayback();
    closeStreamRef.current?.();
    closeStreamRef.current = null;
    modeRef.current = "recorded";
    setMode("recorded");
    setReceipt(preferredReceiptRef.current);
    setReceiptVerified(true);
    setLiveReceiptReady(false);
    setLiveRunId(null);
    setInvalidRun(null);
    setLiveEvents([]);
    setBusy(false);
    setRevealed(false);
    setActiveIndex(0);
    setView("trial");
    setNotice("검증된 60초 재판을 압축 재생 중입니다. 화면의 시간 표기는 원 실행 타임라인입니다.");

    replayTimeline.forEach((_, index) => {
      if (index === 0) return;
      const timer = window.setTimeout(() => {
        setActiveIndex(index);
        const nextView = VIEW_AT_STAGE[index];
        if (nextView) setView(nextView);
        if (index === replayTimeline.length - 1) {
          setRevealed(true);
          setNotice("재생 완료: 실제 PC01 영수증과 13개 임계 게이트를 확인했습니다.");
        }
      }, index * 900);
      timersRef.current.push(timer);
    });
  }, [clearPlayback]);

  const startLive = useCallback(async () => {
    clearPlayback();
    closeStreamRef.current?.();
    modeRef.current = "live";
    setBusy(true);
    setMode("live");
    setReceiptVerified(false);
    setLiveReceiptReady(false);
    setLiveRunId(null);
    setInvalidRun(null);
    setLiveEvents([]);
    setActiveIndex(0);
    setView("trial");
    setNotice("소유한 로컬 fixture에 실시간 재판을 접수하고 있습니다.");
    try {
      const run = await createLiveRun();
      setLiveRunId(run.id);
      setNotice(`실시간 run ${run.id} 접수 완료 · ${run.status}`);
      setActiveIndex(STATUS_TO_STAGE[run.status] ?? 0);
      closeStreamRef.current = subscribeToRun(run.id, {
        onEvent: (event) => {
            const nextStage = event.status ? STATUS_TO_STAGE[event.status] : undefined;
            setLiveEvents((current) => [
              ...current,
              {
                time: event.at
                  ? new Date(event.at).toLocaleTimeString("ko-KR", { hour12: false })
                  : "LIVE",
                stage: nextStage === undefined ? "기록" : replayTimeline[nextStage].stage,
                message: event.message ?? event.type ?? "실시간 이벤트 수신",
              },
            ]);
            if (event.status) {
              if (nextStage !== undefined) {
                setActiveIndex(nextStage);
              }
            }
            if (event.message) setNotice(event.message);
        },
        onReceiptReady: async (payload) => {
          closeStreamRef.current = null;
          if (payload.status === "invalid") {
            let summary: InvalidRunSummary = {
              runId: payload.runId,
              status: "invalid",
              receiptId: payload.receiptId,
              failure: null,
              execution: null,
            };
            try {
              summary = await fetchInvalidRunSummary(payload.runId, payload.receiptId);
            } catch {
              // The named terminal event is still an authoritative minimal invalid record.
            }
            setInvalidRun(summary);
            setLiveReceiptReady(false);
            setReceiptVerified(false);
            setActiveIndex(5);
            setRevealed(false);
            setView("receipt");
            setNotice(`실행 무효 · 판결 없음 · 인컴번트 변경 없음 · ${payload.runId}`);
            return;
          }
          try {
            const liveReceipt = await fetchRunReceipt(payload.runId);
            setReceipt(liveReceipt);
            setInvalidRun(null);
            setReceiptVerified(true);
            setLiveReceiptReady(true);
            setActiveIndex(5);
            setRevealed(false);
            setView("receipt");
            setNotice(
              liveReceipt.comparison.decision === "promote"
                ? `실시간 승격 판결 완료 · ${liveReceipt.receiptId}`
                : `실시간 기각 판결 완료 · 인컴번트 유지 · ${liveReceipt.receiptId}`,
            );
          } catch {
            setNotice("실시간 영수증의 정규화 해시 또는 PC01 계약을 검증하지 못했습니다.");
            setView("trial");
          }
        },
        onConnectionError: () => {
          setNotice("실시간 이벤트 연결을 다시 시도하고 있습니다. 판결 전에는 리플레이로 대체하지 않습니다.");
        },
      });
    } catch {
      modeRef.current = "recorded";
      setMode("recorded");
      setLiveRunId(null);
      setLiveEvents([]);
      setActiveIndex(-1);
      if (preferredVerifiedRef.current) {
        startReplay();
      } else {
        setNotice("실시간 API가 연결되지 않았습니다. 저장된 영수증 무결성 검증이 끝나면 리플레이를 시작할 수 있습니다.");
      }
    } finally {
      setBusy(false);
    }
  }, [clearPlayback, startReplay]);

  function resetCourt() {
    clearPlayback();
    closeStreamRef.current?.();
    closeStreamRef.current = null;
    modeRef.current = "recorded";
    setMode("recorded");
    setReceipt(preferredReceiptRef.current);
    setReceiptVerified(preferredVerifiedRef.current);
    setLiveReceiptReady(false);
    setLiveRunId(null);
    setInvalidRun(null);
    setLiveEvents([]);
    setActiveIndex(-1);
    setRevealed(false);
    setView("trial");
    setNotice("재판이 초기화됐습니다. 새 실시간 실행 또는 검증된 리플레이를 시작할 수 있습니다.");
  }

  async function inspectRejection() {
    if (!(await verifyReceipt(recordedRejectionReceipt))) {
      setNotice("저장된 기각 영수증의 정규화 해시를 검증하지 못했습니다.");
      return;
    }
    clearPlayback();
    closeStreamRef.current?.();
    closeStreamRef.current = null;
    modeRef.current = "recorded";
    setMode("recorded");
    setReceipt(recordedRejectionReceipt);
    setReceiptVerified(true);
    setLiveReceiptReady(false);
    setLiveRunId(null);
    setInvalidRun(null);
    setLiveEvents([]);
    setActiveIndex(5);
    setRevealed(false);
    setView("receipt");
    setNotice("검증된 기각 계보: 임계 게이트 실패로 후보를 버리고 인컴번트를 유지했습니다.");
  }

  function changeView(nextView: ViewName) {
    if (invalidRun && nextView !== "receipt") {
      setView("receipt");
      setNotice("실행 무효 run에는 비교·승격 결과가 없습니다. 무효 리포트를 유지합니다.");
      return;
    }
    if (mode === "recorded" && !receiptVerified && nextView !== "trial") {
      setView("trial");
      setNotice("영수증 무결성을 검증하는 동안 결과 화면을 잠갔습니다.");
      return;
    }
    setView(nextView);
  }

  return (
    <AppShell
      activeIndex={activeIndex}
      mode={mode}
      onViewChange={changeView}
      receiptId={
        mode === "live" && !liveReceiptReady && !invalidRun
          ? `RUN …${liveRunId?.slice(-8) ?? "PENDING"} · RECEIPT PENDING`
          : invalidRun
            ? invalidRun.receiptId ?? `RUN …${invalidRun.runId.slice(-8)} · INVALID`
          : receiptVerified
            ? receipt.receiptId
            : "RECEIPT VERIFYING"
      }
      terminalLabel={
        invalidRun
          ? "무효"
          : mode === "live" && !liveReceiptReady
          ? "판결"
          : receipt.comparison.decision === "reject"
            ? "기각"
            : "승격"
      }
      view={view}
    >
      {view === "trial" ? (
        <TrialDashboard
          activeIndex={activeIndex}
          busy={busy}
          mode={mode}
          liveEvents={liveEvents}
          notice={notice}
          onReplay={startReplay}
          onInspectRejection={inspectRejection}
          onStart={startLive}
          receipt={receipt}
          receiptVerified={receiptVerified}
        />
      ) : null}
      {mode === "live" && !liveReceiptReady && !invalidRun && view !== "trial" ? (
        <LivePending activeIndex={activeIndex} events={liveEvents} notice={notice} view={view} />
      ) : null}
      {view === "evidence" && (mode !== "live" || liveReceiptReady) ? (
        <EvidenceCourt mode={mode} receipt={receipt} />
      ) : null}
      {view === "comparison" && (mode !== "live" || liveReceiptReady) ? (
        <BlindComparison
          mode={mode}
          onReveal={() => setRevealed(true)}
          receipt={receipt}
          revealed={revealed}
        />
      ) : null}
      {view === "receipt" && (mode !== "live" || liveReceiptReady) ? (
        receipt.comparison.decision === "promote" ? (
          <ChampionReceipt mode={mode} onRetry={resetCourt} receipt={receipt} />
        ) : (
          <RejectionReceipt mode={mode} onRetry={resetCourt} receipt={receipt} />
        )
      ) : null}
      {view === "receipt" && invalidRun ? (
        <InvalidRunReport onReplay={startReplay} onRetry={startLive} run={invalidRun} />
      ) : null}
    </AppShell>
  );
}
