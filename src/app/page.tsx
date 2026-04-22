"use client";

import { useState, useRef, useEffect } from "react";
import CodeEditor from "@/components/CodeEditor";
import ReactMarkdown from "react-markdown";

// ── Types ──────────────────────────────────────────────────────────────────

type Phase = "submit" | "diagnose" | "fix";

interface Message {
  role: "tutor" | "student";
  content: string;
}

interface DiagnosisResult {
  lineNumber: number;
  conceptName: string;
  conceptBlurb: string;
  hypothesisPrompt: string;    // shown above the Working Hypothesis card
  internalBugSummary: string;
  observationUnsure: boolean;  // true if student chose "I'm not sure" at Submit
}

// Single-field cause hypothesis — observation is captured separately at Submit.
interface WorkingHypothesis {
  possibleCause: string;
}

interface HypothesisEntry extends WorkingHypothesis {
  timestamp: number;
}

// Chip options for the observed-behavior field on the Submit screen.
// Plain-language symptom phrasing only — never error-type vocabulary.
const OBSERVATION_CHIPS = [
  "It's giving unexpected output",
  "It crashes with an error",
  "It runs forever / freezes",
  "It doesn't compile / won't run at all",
  "I'm not sure",
] as const;

// ── Constants ──────────────────────────────────────────────────────────────

const SEED_CODE = `def find_max(numbers):
    max_val = numbers[0]
    for i in range(1, len(numbers) - 1):
        if numbers[i] > max_val:
            max_val = numbers[i]
    return max_val

result = find_max([3, 7, 2, 4, 9])
print(result)
`;

const PHASE_LABELS: Record<Phase, string> = {
  submit: "Submit",
  diagnose: "Diagnose",
  fix: "Fix",
};

// Generate or retrieve a stable browser-local user ID for cross-session memory.
// This runs only on the client, so it's safe to reference localStorage here.
function getOrCreateUserId(): string {
  const KEY = "sdt_user_id";
  const existing = localStorage.getItem(KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(KEY, id);
  return id;
}

// ── Top-level sub-components ───────────────────────────────────────────────
// Defined outside Home so React sees stable component identity across renders.
// Defining them inside Home would cause unmount/remount on every keystroke,
// destroying focus in any contained input.

interface WorkingHypothesisCardProps {
  diagnosisResult: DiagnosisResult | null;
  observedBehavior: string;
  setObservedBehavior: (v: string) => void;
  workingHypothesis: WorkingHypothesis | null;
  setWorkingHypothesis: (v: WorkingHypothesis | null) => void;
  hypothesisHistory: HypothesisEntry[];
  setHypothesisHistory: (updater: (prev: HypothesisEntry[]) => HypothesisEntry[]) => void;
  draftHypothesis: WorkingHypothesis;
  setDraftHypothesis: (v: WorkingHypothesis) => void;
  hypothesisCardEditing: boolean;
  setHypothesisCardEditing: (v: boolean) => void;
  hypothesisCommitted: boolean;
  isLoading: boolean;
  onHypothesisSubmit: (h: WorkingHypothesis) => void;
  onUnsure: () => void;
  onCommit: () => void;
}

interface InlineEditBlockProps {
  label: string;
  value: string;
  placeholder: string;
  nullDisplay?: string;
  onSave: (v: string) => void;
  disabled?: boolean;
  fullHeight?: boolean;
}

function InlineEditBlock({
  label,
  value,
  placeholder,
  nullDisplay,
  onSave,
  disabled = false,
  fullHeight = false,
}: InlineEditBlockProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (isEditing) {
    return (
      <div className={`bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md p-2 ${fullHeight ? "flex-1 flex flex-col" : ""}`}>
        <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">{label}</label>
        <textarea
          className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-md p-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none disabled:opacity-50 flex-1"
          rows={fullHeight ? undefined : 2}
          style={fullHeight ? { flex: 1 } : undefined}
          autoFocus
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex gap-2 mt-1.5">
          <button
            className="text-xs text-emerald-600 font-medium hover:text-emerald-500 transition"
            onClick={() => {
              onSave(draft);
              setIsEditing(false);
            }}
          >
            Save
          </button>
          <button
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition"
            onClick={() => {
              setDraft(value);
              setIsEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (disabled) {
    return (
      <div className={`bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md px-3 py-2 ${fullHeight ? "flex-1" : ""}`}>
        <span className="block text-xs font-medium text-[var(--text-muted)] mb-0.5">{label}</span>
        {!value && nullDisplay ? (
          <span className="text-sm text-[var(--text-muted)] italic">{nullDisplay}</span>
        ) : (
          <span className="text-sm text-[var(--text-secondary)]">{value}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md px-3 py-2 cursor-pointer hover:border-[var(--accent)] transition ${fullHeight ? "flex-1 flex flex-col" : ""}`}
      onClick={() => {
        setDraft(value);
        setIsEditing(true);
      }}
    >
      <span className="flex items-center justify-between text-xs font-medium text-[var(--text-muted)] mb-0.5">
        <span>{label}</span>
        <span>✎</span>
      </span>
      <div className={fullHeight ? "flex-1" : ""}>
        {!value && nullDisplay ? (
          <span className="text-sm text-[var(--text-muted)] italic">{nullDisplay}</span>
        ) : (
          <span className="text-sm text-[var(--text-secondary)]">{value}</span>
        )}
      </div>
    </div>
  );
}

// Displays the ordered stack of previous hypothesis revisions.
// Only rendered when hypothesisHistory.length > 1 (current version is shown
// separately in the pinned card, so history.length - 1 = number of prior versions).
function RevisionStack({ history }: { history: HypothesisEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  // All entries except the last one, which is the current version shown above.
  const previous = history.slice(0, -1);
  if (previous.length === 0) return null;

  function formatRelativeTime(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin === 1) return "1 min ago";
    if (diffMin < 60) return `${diffMin} mins ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr === 1) return "1 hr ago";
    return `${diffHr} hrs ago`;
  }

  return (
    <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
      <button
        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition flex items-center gap-1"
        onClick={() => setExpanded((e) => !e)}
      >
        <span>{expanded ? "▾" : "▸"}</span>
        <span>
          {previous.length === 1
            ? "1 previous version"
            : `${previous.length} previous versions`}
        </span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* Show oldest → newest so reading top-to-bottom shows the arc */}
          {[...previous].reverse().map((entry, i) => (
            <div
              key={entry.timestamp}
              className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md px-3 py-2"
            >
              <span className="block text-xs text-[var(--text-muted)] mb-0.5">
                Version {previous.length - i} · {formatRelativeTime(entry.timestamp)}
              </span>
              <p className="text-sm text-[var(--text-secondary)]">{entry.possibleCause}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkingHypothesisCard({
  diagnosisResult,
  observedBehavior,
  setObservedBehavior,
  workingHypothesis,
  setWorkingHypothesis,
  hypothesisHistory,
  setHypothesisHistory,
  draftHypothesis,
  setDraftHypothesis,
  hypothesisCardEditing,
  setHypothesisCardEditing,
  hypothesisCommitted,
  isLoading,
  onHypothesisSubmit,
  onUnsure,
  onCommit,
}: WorkingHypothesisCardProps) {
  // Local UI state for the "I think I've got it" confirmation flow.
  // true = student has clicked the button and is being shown the confirmation view.
  const [commitPending, setCommitPending] = useState(false);

  // While the diagnose-init call is in flight, show a skeleton.
  if (!diagnosisResult) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md p-4 mb-4 animate-pulse">
        <div className="h-3 bg-[var(--bg-elevated)] rounded w-1/3 mb-3" />
        <div className="h-3 bg-[var(--bg-elevated)] rounded w-2/3" />
      </div>
    );
  }

  // ── Pending / editing state ───────────────────────────────────────────────
  if (hypothesisCardEditing) {
    const isPending = workingHypothesis === null;

    function handleFormSubmit() {
      const trimmed = draftHypothesis.possibleCause.trim();
      if (!trimmed) return;
      onHypothesisSubmit({ possibleCause: trimmed });
    }

    function handleCancelEdit() {
      if (workingHypothesis) setDraftHypothesis(workingHypothesis);
      setHypothesisCardEditing(false);
    }

    return (
      <>
        <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
          Working Hypothesis
        </div>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md p-4 mb-4">
        {/* Observed behavior — editable, shown as context above the hypothesis field */}
        <InlineEditBlock
          label="What's happening"
          value={observedBehavior}
          placeholder="Describe what's going wrong…"
          onSave={setObservedBehavior}
        />

        {/* Tutor's orienting prompt from diagnose-init — mt-4 matches spacing below */}
        <p className="text-sm text-[var(--text-secondary)] mt-4 mb-3">{diagnosisResult.hypothesisPrompt}</p>

        {/* Single cause hypothesis field */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-[var(--text-muted)] mb-1">
            What do you think might be causing this?
          </label>
          <textarea
            className="w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md p-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none disabled:opacity-50"
            rows={3}
            placeholder="Your best guess — even a vague idea is a great start…"
            value={draftHypothesis.possibleCause}
            disabled={isLoading}
            onChange={(e) => setDraftHypothesis({ possibleCause: e.target.value })}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            className="bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md transition"
            onClick={handleFormSubmit}
            disabled={isLoading || !draftHypothesis.possibleCause.trim()}
          >
            {isLoading ? "Submitting…" : isPending ? "Submit hypothesis" : "Save revision"}
          </button>

          {/* "I'm not sure" — first-class option at the cause level */}
          {isPending && (
            <button
              className="bg-transparent border border-[var(--border)] hover:border-[var(--accent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-medium px-4 py-1.5 rounded-md transition disabled:opacity-50"
              onClick={onUnsure}
              disabled={isLoading}
            >
              I'm not sure
            </button>
          )}

          {/* Cancel — only shown when editing an existing hypothesis */}
          {!isPending && (
            <button
              className="bg-transparent border border-[var(--border)] hover:border-[var(--accent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-medium px-4 py-1.5 rounded-md transition"
              onClick={handleCancelEdit}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
      </>
    );
  }

  // ── Pinned state ──────────────────────────────────────────────────────────
  return (
    <>
      <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
        Working Hypothesis
      </div>
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md p-4 mb-4">
      {/* Two side-by-side cells: observation (left) and hypothesis (right) — always equal height */}
      <div className="flex gap-3 items-stretch">
        <div className="w-1/2 flex flex-col">
          <InlineEditBlock
            label="What's happening"
            value={observedBehavior}
            placeholder="Describe what's going wrong…"
            onSave={setObservedBehavior}
            fullHeight
          />
        </div>
        <div className="w-1/2 flex flex-col">
          <InlineEditBlock
            label="Your hypothesis"
            value={workingHypothesis?.possibleCause ?? ""}
            nullDisplay="Not sure yet"
            placeholder="What do you think might be causing this?…"
            onSave={(v) => {
              if (v.trim()) {
                setWorkingHypothesis({ possibleCause: v.trim() });
                setHypothesisHistory((prev) => [
                  ...prev,
                  { possibleCause: v.trim(), timestamp: Date.now() },
                ]);
              }
            }}
            disabled={hypothesisCommitted}
            fullHeight
          />
        </div>
      </div>

      {/* Revision stack — shown when there are previous versions */}
      <RevisionStack history={hypothesisHistory} />

      {/* "I think I've got it" — commitment flow */}
      {workingHypothesis && !hypothesisCommitted && (
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)]">
          {commitPending ? (
            // ── Confirmation view ───────────────────────────────────────────
            <div>
              <p className="text-xs text-[var(--text-muted)] mb-2">
                Ready to lock this in as your hypothesis?
              </p>
              <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-md px-3 py-2 mb-3">
                <span className="block text-xs font-medium text-[var(--text-muted)] mb-0.5">
                  Your current hypothesis
                </span>
                <p className="text-sm text-[var(--text-secondary)]">
                  {workingHypothesis.possibleCause}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md transition"
                  onClick={() => {
                    setCommitPending(false);
                    onCommit();
                  }}
                  disabled={isLoading}
                >
                  {isLoading ? "Checking…" : "Yes, that's my hypothesis"}
                </button>
                <button
                  className="bg-transparent border border-[var(--border)] hover:border-[var(--accent)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm font-medium px-4 py-1.5 rounded-md transition"
                  onClick={() => setCommitPending(false)}
                  disabled={isLoading}
                >
                  Keep working
                </button>
              </div>
            </div>
          ) : (
            // ── Default button ──────────────────────────────────────────────
            <button
              className="text-sm text-[var(--accent)] font-medium hover:opacity-80 transition"
              onClick={() => setCommitPending(true)}
            >
              I think I've got it →
            </button>
          )}
        </div>
      )}
    </div>
    </>
  );
}

interface RetrospectivePanelProps {
  hypothesisHistory: HypothesisEntry[];
  sessionSummary: string | null;
}

// Retrospective panel — shown in the Fix phase after a correct fix verdict.
// Displays the student's hypothesis arc (ordered revisions) plus the
// concept summary from fix-eval. This is the session's distilled artifact
// and the primary CTA gap-analysis data source.
//
// Note: the warmer one-line retrospectiveSummary from the session-summary
// API call is not yet wired here — sessionSummary currently stores
// conceptSummary from fix-eval. A future iteration could await the
// session-summary response and use retrospectiveSummary instead.
function RetrospectivePanel({ hypothesisHistory, sessionSummary }: RetrospectivePanelProps) {
  if (!sessionSummary) return null;

  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-md p-4 mb-4">
      {/* Header */}
      <div className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">
        Session recap
      </div>

      {/* What you learned — the concept summary from fix-eval */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 mb-3">
        <span className="block text-xs font-medium text-emerald-700 mb-1">
          What you learned
        </span>
        <p className="text-sm text-emerald-900 leading-relaxed">{sessionSummary}</p>
      </div>

      {/* Hypothesis arc — how the student's thinking evolved */}
      {hypothesisHistory.length > 0 && (
        <div>
          <span className="block text-xs font-medium text-[var(--text-muted)] mb-2">
            How your thinking evolved
          </span>
          <div className="space-y-1.5">
            {hypothesisHistory.map((entry, i) => {
              const isFirst = i === 0;
              const isLast = i === hypothesisHistory.length - 1;
              return (
                <div key={entry.timestamp} className="flex gap-2 items-start">
                  {/* Arc indicator */}
                  <div className="flex flex-col items-center mt-1 shrink-0">
                    <div
                      className={`w-2 h-2 rounded-full border ${
                        isLast
                          ? "bg-emerald-500 border-emerald-500"
                          : "bg-transparent border-[var(--border)]"
                      }`}
                    />
                    {!isLast && (
                      <div className="w-px flex-1 bg-[var(--border)] mt-1" style={{ minHeight: "12px" }} />
                    )}
                  </div>
                  {/* Hypothesis text */}
                  <div className="pb-1.5">
                    <span className="text-xs text-[var(--text-muted)]">
                      {isFirst && hypothesisHistory.length > 1 ? "Started with: " : ""}
                      {isLast && hypothesisHistory.length > 1 ? "Landed on: " : ""}
                    </span>
                    <p className="text-sm text-[var(--text-secondary)] leading-snug">
                      {entry.possibleCause}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

interface ChatHistoryProps {
  conversationHistory: Message[];
  isLoading: boolean;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}

function ChatHistory({ conversationHistory, isLoading, chatEndRef }: ChatHistoryProps) {
  return (
    <div className="flex-1 overflow-y-auto space-y-3 pr-1">
      {conversationHistory.length === 0 && !isLoading && (
        <p className="text-sm text-[var(--text-muted)] italic">
          The conversation will appear here once you submit your hypothesis.
        </p>
      )}
      {conversationHistory.map((msg, i) => (
        <div
          key={i}
          className={`flex ${msg.role === "student" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
              msg.role === "tutor"
                ? "bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-primary)]"
                : "bg-[var(--accent-dim)] border border-[var(--accent)] text-[var(--text-primary)]"
            }`}
          >
            {msg.role === "tutor" ? (
              <ReactMarkdown
                components={{
                  code({ children, className, ...props }) {
                    const isBlock = className?.startsWith("language-");
                    return isBlock ? (
                      <pre className="bg-[var(--bg-base)] border border-[var(--border)] rounded p-2 overflow-x-auto my-1.5">
                        <code className="font-mono text-xs text-[var(--text-primary)]" {...props}>
                          {children}
                        </code>
                      </pre>
                    ) : (
                      <code
                        className="font-mono text-xs bg-[var(--bg-base)] border border-[var(--border)] rounded px-1 py-0.5 text-[var(--accent)]"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                  p({ children }) {
                    return <p className="mb-1.5 last:mb-0">{children}</p>;
                  },
                }}
              >
                {msg.content}
              </ReactMarkdown>
            ) : (
              msg.content
            )}
          </div>
        </div>
      ))}
      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] text-sm rounded-lg px-3 py-2 flex items-center gap-2">
            <svg className="animate-spin h-3.5 w-3.5 text-[var(--accent)] shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <span>Thinking…</span>
          </div>
        </div>
      )}
      <div ref={chatEndRef} />
    </div>
  );
}

interface CodePanelsProps {
  originalCode: string;
  code: string;
  setCode: (v: string) => void;
  editable: boolean;
  phase: Phase;
  diagnosisResult: DiagnosisResult | null;
  isLoading: boolean;
  onSubmitFix: () => void;
  onResetCode: () => void;
}

function CodePanels({
  originalCode,
  code,
  setCode,
  editable,
  phase,
  diagnosisResult,
  isLoading,
  onSubmitFix,
  onResetCode,
}: CodePanelsProps) {
  const isFixPhase = phase === "fix";

  return (
    <div className="flex flex-col gap-4 h-full" style={{ width: "50%" }}>
      <div>
        <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
          Original code
        </label>
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-md overflow-hidden">
          <CodeEditor
            value={originalCode}
            onChange={() => {}}
            readOnly
            height="200px"
            highlightLine={diagnosisResult?.lineNumber ?? null}
          />
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {/* In Fix phase: highlight the working copy as the active editing target */}
        <div className="flex items-center justify-between mb-2">
          <label className={`block text-xs font-medium uppercase tracking-wide ${
            isFixPhase ? "text-emerald-400" : "text-[var(--text-muted)]"
          }`}>
            {isFixPhase ? "Your working copy — apply your fix here" : "Your working copy"}
          </label>
          {/* Reset to original — icon with tooltip, only shown in Fix phase */}
          {isFixPhase && (
            <div className="relative group">
              <button
                className="p-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition"
                onClick={onResetCode}
                aria-label="Reset code to original"
              >
                {/* Refresh/reset icon */}
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
              <span className="absolute right-0 top-full mt-1 px-2 py-1 text-xs bg-[var(--bg-elevated)] border border-[var(--border)] rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10 text-[var(--text-secondary)]">
                Reset code to original
              </span>
            </div>
          )}
        </div>
        {/* Accent ring around editor in Fix phase to signal active editing target */}
        <div className={isFixPhase ? "ring-1 ring-[var(--accent)] rounded-md overflow-hidden flex-1 flex flex-col" : "flex-1 flex flex-col"}>
          <CodeEditor
            value={code}
            onChange={editable ? setCode : () => {}}
            readOnly={!editable}
            height="100%"
          />
        </div>
      </div>

      {isFixPhase && (
        <button
          className="bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-md transition"
          onClick={onSubmitFix}
          disabled={isLoading}
        >
          Submit fix
        </button>
      )}
    </div>
  );
}

// ── Home ───────────────────────────────────────────────────────────────────

export default function Home() {
  // ── Phase / code state ───────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("submit");
  const [code, setCode] = useState(SEED_CODE);
  const [originalCode, setOriginalCode] = useState("");
  const [studentIntent, setStudentIntent] = useState("");
  // observedBehavior: required at Submit, editable inline on the hypothesis card.
  // May differ from what was captured at Submit — always pass current value to API.
  const [observedBehavior, setObservedBehavior] = useState("");

  // ── Conversation state ───────────────────────────────────────────────────
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
  const [studentReply, setStudentReply] = useState("");

  // ── Diagnosis state ──────────────────────────────────────────────────────
  // diagnosisResult is internal — conceptName/conceptBlurb are used to guide
  // questioning and are never shown directly to the student.
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);

  // ── Hypothesis state ─────────────────────────────────────────────────────
  // workingHypothesis: the student's current live hypothesis (null before first submission
  // or if student chose "I'm not sure").
  // hypothesisHistory: ordered stack of every committed revision, oldest first.
  // hypothesisCommitted: true after "I think I've got it" is confirmed and validated.
  const [workingHypothesis, setWorkingHypothesis] = useState<WorkingHypothesis | null>(null);
  const [hypothesisHistory, setHypothesisHistory] = useState<HypothesisEntry[]>([]);
  const [hypothesisCommitted, setHypothesisCommitted] = useState(false);

  // ── Session / memory state ───────────────────────────────────────────────
  // sessionSummary: generated at session end by the session-summary API call.
  // userId: stable browser-local UUID for cross-session memory storage.
  const [sessionSummary, setSessionSummary] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");

  // ── UI state ─────────────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);

  // Local draft state for the Working Hypothesis card.
  // Kept separate from workingHypothesis so the student can edit without
  // overwriting the committed hypothesis until they hit Submit/Save.
  const [draftHypothesis, setDraftHypothesis] = useState<WorkingHypothesis>({
    possibleCause: "",
  });
  // "editing" covers both the initial pending state and a mid-session edit.
  const [hypothesisCardEditing, setHypothesisCardEditing] = useState(true);

  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Effects ───────────────────────────────────────────────────────────────

  // Initialise userId from localStorage on mount (client-only).
  useEffect(() => {
    setUserId(getOrCreateUserId());
  }, []);

  // Auto-scroll chat to bottom when history or loading state changes.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationHistory, isLoading]);

  // ── API helper ────────────────────────────────────────────────────────────

  async function callTutorAPI(payload: object): Promise<Record<string, unknown> | null> {
    setIsLoading(true);
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Tutor API error:", data);
        return null;
      }
      return data as Record<string, unknown>;
    } catch (err) {
      console.error("Fetch error:", err);
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleStartDebugging() {
    const snapshot = code;
    setOriginalCode(snapshot);
    setPhase("diagnose");

    const data = await callTutorAPI({
      mode: "diagnose-init",
      code: snapshot,
      studentIntent,
      observedBehavior,
      userId,
    });
    if (!data) return;

    const result: DiagnosisResult = {
      lineNumber: data.lineNumber as number,
      conceptName: data.conceptName as string,
      conceptBlurb: data.conceptBlurb as string,
      hypothesisPrompt: data.hypothesisPrompt as string,
      internalBugSummary: data.internalBugSummary as string,
      observationUnsure: data.observationUnsure as boolean,
    };
    setDiagnosisResult(result);
    // Do NOT add anything to conversationHistory here — the hypothesis card
    // UI, not the chat, is the student's first interaction in Diagnose.
  }

  async function handleHypothesisSubmit(hypothesis: WorkingHypothesis) {
    // Push the new revision onto the history stack.
    const entry: HypothesisEntry = { ...hypothesis, timestamp: Date.now() };
    setWorkingHypothesis(hypothesis);
    setHypothesisHistory((prev) => [...prev, entry]);

    const data = await callTutorAPI({
      mode: "diagnose-hypothesis",
      code: originalCode,
      studentIntent,
      observedBehavior,
      workingHypothesis: hypothesis,
      internalBugSummary: diagnosisResult?.internalBugSummary ?? null,
      conversationHistory,
      userId,
    });
    if (!data) return;

    const tutorMsg: Message = { role: "tutor", content: data.tutorMessage as string };
    setConversationHistory((prev) => [...prev, tutorMsg]);

    // Card transitions to pinned state.
    setHypothesisCardEditing(false);

    // Step 5 will handle offerHypothesisUpdate prompt.
    // Step 11 will handle predictObserveExplain.
  }

  async function handleUnsure() {
    setWorkingHypothesis(null);

    const data = await callTutorAPI({
      mode: "diagnose-unsure",
      code: originalCode,
      studentIntent,
      observedBehavior,
      observationUnsure: diagnosisResult?.observationUnsure ?? false,
      internalBugSummary: diagnosisResult?.internalBugSummary ?? null,
      userId,
    });
    if (!data) return;

    const tutorMsg: Message = { role: "tutor", content: data.tutorMessage as string };
    setConversationHistory([tutorMsg]);
    // Transition card to pinned state — shows "Starting from scratch" placeholder.
    setHypothesisCardEditing(false);
  }

  async function handleSendReply() {
    if (!studentReply.trim() || isLoading) return;

    const studentMsg: Message = { role: "student", content: studentReply.trim() };
    const updatedHistory = [...conversationHistory, studentMsg];
    setConversationHistory(updatedHistory);
    setStudentReply("");

    const data = await callTutorAPI({
      mode: "diagnose-hypothesis",
      code: originalCode,
      studentIntent,
      observedBehavior,
      workingHypothesis,
      internalBugSummary: diagnosisResult?.internalBugSummary ?? null,
      conversationHistory: updatedHistory,
      studentMessage: studentMsg.content,
      userId,
    });
    if (!data) return;

    const tutorMsg: Message = { role: "tutor", content: data.tutorMessage as string };
    setConversationHistory((prev) => [...prev, tutorMsg]);

    // Step 5 will handle offerHypothesisUpdate prompt.
    // Step 11 will handle predictObserveExplain.
  }

  async function handleCommitHypothesis() {
    if (!workingHypothesis) return;

    const data = await callTutorAPI({
      mode: "diagnose-commit",
      code: originalCode,
      studentIntent,
      observedBehavior,
      workingHypothesis,
      hypothesisHistory,
      internalBugSummary: diagnosisResult?.internalBugSummary ?? null,
      conceptName: diagnosisResult?.conceptName ?? null,
      conceptBlurb: diagnosisResult?.conceptBlurb ?? null,
      conversationHistory,
      userId,
    });
    if (!data) return;

    const tutorMsg: Message = { role: "tutor", content: data.tutorMessage as string };
    setConversationHistory((prev) => [...prev, tutorMsg]);

    if (data.conceptEarned) {
      setHypothesisCommitted(true);
      setPhase("fix");
    }
    // If conceptEarned is false, the tutor message pushes back — student stays in Diagnose.
  }

  async function handleSubmitFix() {
    if (isLoading) return;

    const data = await callTutorAPI({
      mode: "fix-eval",
      originalCode,
      currentCode: code,
      conceptName: diagnosisResult?.conceptName ?? null,
      internalBugSummary: diagnosisResult?.internalBugSummary ?? null,
      conversationHistory,
    });
    if (!data) return;

    const tutorMsg: Message = { role: "tutor", content: data.tutorMessage as string };
    setConversationHistory((prev) => [...prev, tutorMsg]);

    if (data.verdict === "correct") {
      fireSessionSummary(data.conceptSummary as string | null);
    }
  }

  async function fireSessionSummary(conceptSummaryText: string | null) {
    if (conceptSummaryText) {
      setSessionSummary(conceptSummaryText);
    }

    fetch("/api/tutor", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "session-summary",
        code: originalCode,
        conceptName: diagnosisResult?.conceptName ?? null,
        internalBugSummary: diagnosisResult?.internalBugSummary ?? null,
        hypothesisHistory,
        conversationHistory,
        fixSuccessful: true,
        userId,
      }),
    }).catch((err) => console.warn("Session summary call failed (non-fatal):", err));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      {/* Phase banner */}
      <div className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-8 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-base font-semibold tracking-tight">Traceback: A Socratic Debugging Tutor</h1>
          {/* Step indicator — all 3 steps always visible, active one highlighted */}
          <div className="flex items-center gap-1.5">
            {(["submit", "diagnose", "fix"] as Phase[]).map((p, i) => {
              const isActive = phase === p;
              return (
                <div
                  key={p}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                    isActive
                      ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                      : "bg-transparent text-[var(--text-muted)] border-[var(--border-subtle)]"
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isActive ? "bg-white/20" : "bg-[var(--bg-elevated)]"
                  }`}>
                    {i + 1}
                  </span>
                  {PHASE_LABELS[p]}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-8">
        {/* ── SUBMIT ── */}
        {phase === "submit" && (
          <div className="flex gap-6 h-[calc(100vh-120px)]">
            {/* Left column — code editor */}
            <div className="flex flex-col h-full" style={{ width: "55%" }}>
              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
                Your code
              </label>
              <div className="flex-1 flex flex-col">
                <CodeEditor value={code} onChange={setCode} height="100%" />
              </div>
            </div>

            {/* Right column — fields + button */}
            <div className="flex flex-col" style={{ width: "45%" }}>
              <section className="mb-4">
                <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
                  What should this code do?{" "}
                  <span className="normal-case font-normal text-[var(--text-muted)] opacity-60">(optional)</span>
                </label>
                <textarea
                  className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-md p-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  rows={2}
                  placeholder="e.g. find the max of a list of numbers"
                  value={studentIntent}
                  onChange={(e) => setStudentIntent(e.target.value)}
                />
              </section>

              <section className="mb-4">
                <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-2">
                  What's happening when you run it?
                </label>
                {/* Scaffolding chips — tap to populate the field, then edit if needed */}
                <div className="flex flex-wrap gap-2 mb-2">
                  {OBSERVATION_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className={`text-xs px-3 py-1 rounded-full border transition ${
                        observedBehavior === chip
                          ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                          : "bg-transparent border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)]"
                      }`}
                      onClick={() => setObservedBehavior(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                <textarea
                  className="w-full bg-[var(--bg-card)] border border-[var(--border)] rounded-md p-3 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  rows={2}
                  placeholder="Describe what's going wrong — or tap a chip above to start…"
                  value={observedBehavior}
                  onChange={(e) => setObservedBehavior(e.target.value)}
                />
              </section>

              <div className="flex-1" />

              <button
                className="bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-md transition"
                onClick={handleStartDebugging}
                disabled={isLoading || !observedBehavior.trim()}
              >
                {isLoading ? "Starting…" : "Start debugging"}
              </button>
            </div>
          </div>
        )}

        {/* ── DIAGNOSE ── */}
        {phase === "diagnose" && (
          <div className="flex gap-6 h-[calc(100vh-120px)]">
            <CodePanels
              originalCode={originalCode}
              code={code}
              setCode={setCode}
              editable
              phase={phase}
              diagnosisResult={diagnosisResult}
              isLoading={isLoading}
              onSubmitFix={handleSubmitFix}
              onResetCode={() => {}}
            />

            <div className="flex flex-col" style={{ width: "50%" }}>
              <WorkingHypothesisCard
                diagnosisResult={diagnosisResult}
                observedBehavior={observedBehavior}
                setObservedBehavior={setObservedBehavior}
                workingHypothesis={workingHypothesis}
                setWorkingHypothesis={setWorkingHypothesis}
                hypothesisHistory={hypothesisHistory}
                setHypothesisHistory={setHypothesisHistory}
                draftHypothesis={draftHypothesis}
                setDraftHypothesis={setDraftHypothesis}
                hypothesisCardEditing={hypothesisCardEditing}
                setHypothesisCardEditing={setHypothesisCardEditing}
                hypothesisCommitted={hypothesisCommitted}
                isLoading={isLoading}
                onHypothesisSubmit={handleHypothesisSubmit}
                onUnsure={handleUnsure}
                onCommit={handleCommitHypothesis}
              />

              <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">
                Tutor
              </label>

              <ChatHistory
                conversationHistory={conversationHistory}
                isLoading={isLoading}
                chatEndRef={chatEndRef}
              />

              <div className="flex gap-2 mt-4">
                <textarea
                  className="flex-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-md p-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none disabled:opacity-50"
                  rows={2}
                  placeholder="Type your reply…"
                  value={studentReply}
                  disabled={isLoading}
                  onChange={(e) => setStudentReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendReply();
                    }
                  }}
                />
                <button
                  className="bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-md transition self-end"
                  onClick={handleSendReply}
                  disabled={isLoading || !studentReply.trim()}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── FIX ── */}
        {phase === "fix" && (
          <div className="flex gap-6 h-[calc(100vh-120px)]">
            <CodePanels
              originalCode={originalCode}
              code={code}
              setCode={setCode}
              editable
              phase={phase}
              diagnosisResult={diagnosisResult}
              isLoading={isLoading}
              onSubmitFix={handleSubmitFix}
              onResetCode={() => setCode(originalCode)}
            />

            <div className="flex flex-col" style={{ width: "50%" }}>
              {sessionSummary ? (
                // ── Session complete — replace right column with retrospective ──
                <RetrospectivePanel
                  hypothesisHistory={hypothesisHistory}
                  sessionSummary={sessionSummary}
                />
              ) : (
                // ── Fix in progress — show hypothesis reference + chat ──────────
                <>
                  {/* Hypothesis card — frozen reference for what the student is fixing */}
                  <WorkingHypothesisCard
                    diagnosisResult={diagnosisResult}
                    observedBehavior={observedBehavior}
                    setObservedBehavior={setObservedBehavior}
                    workingHypothesis={workingHypothesis}
                    setWorkingHypothesis={setWorkingHypothesis}
                    hypothesisHistory={hypothesisHistory}
                    setHypothesisHistory={setHypothesisHistory}
                    draftHypothesis={draftHypothesis}
                    setDraftHypothesis={setDraftHypothesis}
                    hypothesisCardEditing={false}
                    setHypothesisCardEditing={() => {}}
                    hypothesisCommitted={true}
                    isLoading={isLoading}
                    onHypothesisSubmit={() => {}}
                    onUnsure={() => {}}
                    onCommit={() => {}}
                  />

                  <label className="block text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-3">
                    Tutor
                  </label>

                  <ChatHistory
                    conversationHistory={conversationHistory}
                    isLoading={isLoading}
                    chatEndRef={chatEndRef}
                  />

                  {/* Chat input — student can ask follow-up questions while fixing */}
                  {/* Note: uses diagnose-hypothesis mode for now; a dedicated fix-chat
                      mode could be added in a future iteration for better context */}
                  <div className="flex gap-2 mt-4">
                    <textarea
                      className="flex-1 bg-[var(--bg-card)] border border-[var(--border)] rounded-md p-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none disabled:opacity-50"
                      rows={2}
                      placeholder="Ask a question about your fix…"
                      value={studentReply}
                      disabled={isLoading}
                      onChange={(e) => setStudentReply(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSendReply();
                        }
                      }}
                    />
                    <button
                      className="bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-md transition self-end"
                      onClick={handleSendReply}
                      disabled={isLoading || !studentReply.trim()}
                    >
                      Send
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}