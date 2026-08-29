import receiptJson from "./pc01-receipt.json";
import rejectionReceiptJson from "./pc01-rejection-receipt.json";
import { staticAssetUrl } from "../lib/assets";
import type { VerifiedReceipt } from "../types";

export const CANONICAL_USER_TASK =
  "Sign in as the brand demo, open Creator Directory, search US, open John Smith, determine audience, verified channel, market fit, and next action, then change the fee to 1500 and prepare an unsent offer draft.";

export const KOREAN_USER_TASK =
  "브랜드 데모로 로그인하고 Creator Directory에서 US를 검색해 John Smith의 신뢰 근거를 판단한 뒤, 제안 금액을 $1,500로 바꾸고 전송하지 않은 초안을 준비하세요.";

export const recordedReceipt = receiptJson as VerifiedReceipt;
export const recordedRejectionReceipt = rejectionReceiptJson as VerifiedReceipt;

export const evidenceAssets: Record<string, string> = {
  "incumbent-desktop-profile": staticAssetUrl("evidence/incumbent-desktop-profile.png"),
  "candidate-desktop-profile": staticAssetUrl("evidence/candidate-desktop-profile.png"),
  "incumbent-mobile-draft": staticAssetUrl("evidence/incumbent-mobile-draft.png"),
  "candidate-mobile-draft": staticAssetUrl("evidence/candidate-mobile-draft.png"),
};

export const replayTimeline = [
  {
    stage: "캡처",
    status: "snapshotting",
    time: "00:00",
    message: "동결된 PC01 소스와 과업 지문을 봉인했습니다.",
  },
  {
    stage: "재현",
    status: "observing_incumbent",
    time: "00:10",
    message: "1280×720과 390×844에서 동일한 브랜드 여정을 재현했습니다.",
  },
  {
    stage: "변론",
    status: "criticizing",
    time: "00:20",
    message: "브라우저 증거로만 세 결함을 채택하고 원자적 피드백을 편집했습니다.",
  },
  {
    stage: "패치",
    status: "patching_candidate",
    time: "00:35",
    message: "보호된 계약을 건드리지 않고 후보 소스에 패치를 적용했습니다.",
  },
  {
    stage: "재심",
    status: "blind_comparison",
    time: "00:45",
    message: "같은 과업을 재실행하고 13개 임계 게이트와 익명 A/B를 판정했습니다.",
  },
  {
    stage: "승격",
    status: "promoted",
    time: "01:00",
    message: "후보가 13개 게이트를 모두 통과해 검증 가능한 영수증을 발급했습니다.",
  },
] as const;

export const findingEvidence = [
  {
    id: "E-01",
    title: "의사결정 근거 0 / 4",
    detail:
      "Audience, verified channel, US market fit, next action이 제품 화면에서 명시되지 않았습니다.",
    gateId: "decision_evidence_complete",
    pin: { x: 63, y: 60 },
  },
  {
    id: "E-02",
    title: "내부 식별 정보 4건 노출",
    detail:
      "OAuth provider 식별자와 내부 API 경로가 사용자 프로필에 렌더링됐습니다.",
    gateId: "no_internal_identifier_exposure",
    pin: { x: 68, y: 78 },
  },
  {
    id: "E-03",
    title: "모바일 가로 넘침 104px",
    detail:
      "390×844에서 주요 제안 액션이 컨테이너 밖으로 밀려났습니다.",
    gateId: "responsive_primary_action",
    pin: { x: 86, y: 88 },
  },
] as const;
