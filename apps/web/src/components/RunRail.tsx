import { useEffect, useRef } from "react";

const BASE_STAGES = ["캡처", "재현", "변론", "패치", "재심"] as const;

export function RunRail({ activeIndex, terminalLabel = "승격" }: { activeIndex: number; terminalLabel?: "판결" | "기각" | "무효" | "승격" }) {
  const stages = [...BASE_STAGES, terminalLabel];
  const activeRef = useRef<HTMLLIElement>(null);
  const safeIndex = Math.max(0, activeIndex);

  useEffect(() => {
    if (activeIndex < 0 || !activeRef.current) return;
    activeRef.current.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [activeIndex]);

  return (
    <section
      className="run-rail-shell"
      aria-label="재판 진행 단계"
      aria-valuemax={6}
      aria-valuemin={1}
      aria-valuenow={safeIndex + 1}
      aria-valuetext={`${safeIndex + 1} / 6 단계 · ${stages[safeIndex]}`}
      role="progressbar"
    >
      <div className="mobile-stage-counter" aria-live="polite">
        <span>{String(safeIndex + 1).padStart(2, "0")} / 06 단계</span>
        <strong>{stages[safeIndex]}</strong>
      </div>
      <div className="run-rail-fade">
        <ol className="run-rail">
          {stages.map((stage, index) => {
            const state =
              activeIndex < 0
                ? index === 0
                  ? "ready"
                  : "idle"
                : index < activeIndex
                  ? "passed"
                  : index === activeIndex
                    ? "active"
                    : "idle";
            return (
              <li
                className={`run-step run-step--${state}`}
                key={stage}
                ref={index === safeIndex ? activeRef : undefined}
                aria-current={state === "active" ? "step" : undefined}
              >
                <span className="run-step__index">{String(index + 1).padStart(2, "0")}</span>
                <span className="run-step__label">{stage}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
