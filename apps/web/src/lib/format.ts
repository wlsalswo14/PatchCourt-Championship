export function shortHash(value: string, head = 10, tail = 8) {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatIssuedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export function judgeValidationSummary(value: {
  invocationCount: number;
  validationRepair: {
    mode: "none" | "format-completion" | "full-rejudge";
    invalidFields: string[];
    digest: string;
  };
}) {
  const repair = value.validationRepair;
  if (repair.mode === "none") {
    return value.invocationCount === 0
      ? `PRE-GATE SHORT CIRCUIT · 0 CALLS · NO REPAIR · PROOF ${shortHash(repair.digest)}`
      : `DIRECT VALIDATION · 1 CALL · NO REPAIR · PROOF ${shortHash(repair.digest)}`;
  }
  const mode = repair.mode === "format-completion" ? "FORMAT COMPLETION" : "FULL REJUDGE";
  return `BOUNDED REPAIR · ${mode} · 2 CALLS · ${repair.invalidFields.length} INVALID FIELD${repair.invalidFields.length === 1 ? "" : "S"} · PROOF ${shortHash(repair.digest)}`;
}

export function humanizeGate(id: string) {
  const labels: Record<string, string> = {
    owned_local_target: "소유한 로컬 대상",
    same_task_fingerprint: "동일 과업 지문",
    brand_demo_login: "브랜드 데모 로그인",
    directory_search: "US 디렉터리 검색",
    profile_open: "John Smith 프로필",
    decision_evidence_complete: "판단 근거 완결성",
    offer_fields_editable: "제안 필드 편집",
    draft_not_sent: "미전송 초안 안전성",
    no_internal_identifier_exposure: "내부 식별자 비노출",
    accessible_primary_controls: "주요 컨트롤 접근성",
    responsive_primary_action: "모바일 주요 액션",
    console_and_network_clean: "콘솔·네트워크 무결성",
    artifact_integrity: "증거 해시 무결성",
  };
  return labels[id] ?? id.replaceAll("_", " ");
}
