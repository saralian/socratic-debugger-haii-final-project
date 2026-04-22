"use client";

import { useState, useRef, useEffect } from "react";
import CodeEditor from "@/components/CodeEditor";

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

const SEED_CODE = `def average(numbers):
    return sum(numbers) / len(numbers) - 1

result = average([2, 4, 6])
print(result)
`;

const PHASE_LABELS: Record<Phase, string> = {
  submit: "Step 1 of 3 — Submit your code",
  diagnose: "Step 2 of 3 — Diagnose the bug",
  fix: "Step 3 of 3 — Fix the bug",
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
}

function InlineEditBlock({
  label,
  value,
  placeholder,
  nullDisplay,
  onSave,
  disabled = false,
}: InlineEditBlockProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (isEditing) {
    return (
      <div className="bg-zinc-50 border border-zinc-200 rounded-md p-2">
        <label className="block text-xs font-medium text-zinc-400 mb-1">{label}</label>
        <textarea
          className="w-full bg-white border border-zinc-300 rounded-md p-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 resize-none"
          rows={2}
          autoFocus
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex gap-2 mt-1.5">
          <button
            className="text-xs text-emerald-700 font-medium hover:text-emerald-600 transition"
            onClick={() => {
              onSave(draft);
              setIsEditing(false);
            }}
          >
            Save
          </button>
          <button
            className="text-xs text-zinc-400 hover:text-zinc-600 transition"
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
      <div className="bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2">
        <span className="block text-xs font-medium text-zinc-400 mb-0.5">{label}</span>
        {!value && nullDisplay ? (
          <span className="text-sm text-zinc-400 italic">{nullDisplay}</span>
        ) : (
          <span className="text-sm text-zinc-700">{value}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className="bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2 cursor-pointer hover:border-zinc-300 transition group"
      onClick={() => {
        setDraft(value);
        setIsEditing(true);
      }}
    >
      <span className="flex items-center justify-between text-xs font-medium text-zinc-400 mb-0.5">
        <span>{label}</span>
        <span className="opacity-0 group-hover:opacity-100 transition">✎</span>
      </span>
      {!value && nullDisplay ? (
        <span className="text-sm text-zinc-400 italic">{nullDisplay}</span>
      ) : (
        <span className="text-sm text-zinc-700">{value}</span>
      )}
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
    <div className="mt-3 pt-3 border-t border-zinc-100">
      <button
        className="text-xs text-zinc-400 hover:text-zinc-600 transition flex items-center gap-1"
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
              className="bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2"
            >
              <span className="block text-xs text-zinc-400 mb-0.5">
                Version {previous.length - i} · {formatRelativeTime(entry.timestamp)}
              </span>
              <p className="text-sm text-zinc-600">{entry.possibleCause}</p>
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
      <div className="bg-white border border-zinc-200 rounded-md p-4 mb-4 animate-pulse">
        <div className="h-3 bg-zinc-100 rounded w-1/3 mb-3" />
        <div className="h-3 bg-zinc-100 rounded w-2/3" />
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
      <div className="bg-white border border-zinc-200 rounded-md p-4 mb-4">
        {/* Observed behavior — editable, shown as context above the hypothesis field */}
        <InlineEditBlock
          label="What's happening"
          value={observedBehavior}
          placeholder="Describe what's going wrong…"
          onSave={setObservedBehavior}
        />

        {/* Tutor's orienting prompt from diagnose-init */}
        <p className="text-sm text-zinc-600 mb-3">{diagnosisResult.hypothesisPrompt}</p>

        {/* Single cause hypothesis field */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-zinc-500 mb-1">
            What do you think might be causing this?
          </label>
          <textarea
            className="w-full bg-zinc-50 border border-zinc-300 rounded-md p-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 resize-none disabled:opacity-50"
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
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md transition"
            onClick={handleFormSubmit}
            disabled={isLoading || !draftHypothesis.possibleCause.trim()}
          >
            {isLoading ? "Submitting…" : isPending ? "Submit hypothesis" : "Save revision"}
          </button>

          {/* "I'm not sure" — first-class option at the cause level */}
          {isPending && (
            <button
              className="bg-white border border-zinc-300 hover:border-zinc-400 text-zinc-600 hover:text-zinc-800 text-sm font-medium px-4 py-1.5 rounded-md transition disabled:opacity-50"
              onClick={onUnsure}
              disabled={isLoading}
            >
              I'm not sure
            </button>
          )}

          {/* Cancel — only shown when editing an existing hypothesis */}
          {!isPending && (
            <button
              className="bg-white border border-zinc-300 hover:border-zinc-400 text-zinc-600 hover:text-zinc-800 text-sm font-medium px-4 py-1.5 rounded-md transition"
              onClick={handleCancelEdit}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Pinned state ──────────────────────────────────────────────────────────
  return (
    <div className="bg-white border border-zinc-200 rounded-md p-4 mb-4">
      {/* Two side-by-side cells: observation (left) and hypothesis (right) */}
      <div className="flex gap-3">
        <div className="w-1/2">
          <InlineEditBlock
            label="What's happening"
            value={observedBehavior}
            placeholder="Describe what's going wrong…"
            onSave={setObservedBehavior}
          />
        </div>
        <div className="w-1/2">
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
          />
        </div>
      </div>

      {/* Revision stack — shown when there are previous versions */}
      <RevisionStack history={hypothesisHistory} />

      {/* "I think I've got it" — commitment flow */}
      {workingHypothesis && !hypothesisCommitted && (
        <div className="mt-3 pt-3 border-t border-zinc-100">
          {commitPending ? (
            // ── Confirmation view ───────────────────────────────────────────
            // Shows the student their current hypothesis before they lock it in.
            // No re-typing required — just confirm or go back.
            <div>
              <p className="text-xs text-zinc-500 mb-2">
                Ready to lock this in as your hypothesis?
              </p>
              <div className="bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2 mb-3">
                <span className="block text-xs font-medium text-zinc-400 mb-0.5">
                  Your current hypothesis
                </span>
                <p className="text-sm text-zinc-700">
                  {workingHypothesis.possibleCause}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-md transition"
                  onClick={() => {
                    setCommitPending(false);
                    onCommit();
                  }}
                  disabled={isLoading}
                >
                  {isLoading ? "Checking…" : "Yes, that's my hypothesis"}
                </button>
                <button
                  className="bg-white border border-zinc-300 hover:border-zinc-400 text-zinc-600 hover:text-zinc-800 text-sm font-medium px-4 py-1.5 rounded-md transition"
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
              className="text-sm text-emerald-700 font-medium hover:text-emerald-600 transition"
              onClick={() => setCommitPending(true)}
            >
              I think I've got it →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface ConceptCardPlaceholderProps {
  conceptRevealed: boolean;
  diagnosisResult: DiagnosisResult | null;
}

function ConceptCardPlaceholder({
  conceptRevealed,
  diagnosisResult,
}: ConceptCardPlaceholderProps) {
  if (!conceptRevealed || !diagnosisResult) return null;
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-md p-4 mb-4">
      <div className="text-xs font-semibold text-amber-600 uppercase tracking-wide mb-1">
        Concept
      </div>
      <div className="text-sm font-semibold text-zinc-800 mb-1">
        {diagnosisResult.conceptName}
      </div>
      <p className="text-sm text-zinc-600">{diagnosisResult.conceptBlurb}</p>
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
        <p className="text-sm text-zinc-400 italic">
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
                ? "bg-blue-50 border border-blue-100 text-zinc-800"
                : "bg-emerald-50 border border-emerald-100 text-zinc-800"
            }`}
          >
            {msg.content}
          </div>
        </div>
      ))}
      {isLoading && (
        <div className="flex justify-start">
          <div className="bg-blue-50 border border-blue-100 text-zinc-400 text-sm rounded-lg px-3 py-2 italic">
            Tutor is thinking…
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
}: CodePanelsProps) {
  return (
    <div className="flex flex-col gap-4 h-full" style={{ width: "55%" }}>
      <div>
        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
          Original code
        </label>
        <div className="bg-zinc-100 border border-zinc-300 rounded-md overflow-hidden">
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
        <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
          Your working copy
        </label>
        <CodeEditor
          value={code}
          onChange={editable ? setCode : () => {}}
          readOnly={!editable}
          height="100%"
        />
      </div>

      {phase === "fix" && (
        <button
          className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-md transition"
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
  // diagnosisResult is internal — conceptName/conceptBlurb are never shown
  // until conceptRevealed is true (after diagnose-commit succeeds).
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);
  const [conceptRevealed, setConceptRevealed] = useState(false);

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
      // Step 7: reveal the Concept card and advance to Fix.
      setHypothesisCommitted(true);
      setConceptRevealed(true);
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
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      {/* Phase banner */}
      <div className="border-b border-zinc-200 bg-white px-8 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold">Socratic Debugging Tutor</h1>
          <span className="text-xs font-medium text-zinc-500 bg-zinc-100 border border-zinc-200 rounded-full px-3 py-1">
            {PHASE_LABELS[phase]}
          </span>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-8">
        {/* ── SUBMIT ── */}
        {phase === "submit" && (
          <div className="flex gap-6 h-[calc(100vh-120px)]">
            {/* Left column — code editor */}
            <div className="flex flex-col h-full" style={{ width: "55%" }}>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
                Your code
              </label>
              <div className="flex-1 flex flex-col">
                <CodeEditor value={code} onChange={setCode} height="100%" />
              </div>
            </div>

            {/* Right column — fields + button */}
            <div className="flex flex-col" style={{ width: "45%" }}>
              <section className="mb-4">
                <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
                  What should this code do?{" "}
                  <span className="normal-case font-normal text-zinc-400">(optional)</span>
                </label>
                <textarea
                  className="w-full bg-white border border-zinc-300 rounded-md p-3 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                  rows={2}
                  placeholder="e.g. compute the average of a list of numbers"
                  value={studentIntent}
                  onChange={(e) => setStudentIntent(e.target.value)}
                />
              </section>

              <section className="mb-4">
                <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">
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
                          ? "bg-zinc-800 border-zinc-800 text-white"
                          : "bg-white border-zinc-300 text-zinc-600 hover:border-zinc-400 hover:text-zinc-800"
                      }`}
                      onClick={() => setObservedBehavior(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                <textarea
                  className="w-full bg-white border border-zinc-300 rounded-md p-3 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                  rows={2}
                  placeholder="Describe what's going wrong — or tap a chip above to start…"
                  value={observedBehavior}
                  onChange={(e) => setObservedBehavior(e.target.value)}
                />
              </section>

              <div className="flex-1" />

              <button
                className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-md transition"
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
            />

            <div className="flex flex-col" style={{ width: "45%" }}>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
                Tutor
              </label>

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

              <ChatHistory
                conversationHistory={conversationHistory}
                isLoading={isLoading}
                chatEndRef={chatEndRef}
              />

              <div className="flex gap-2 mt-4">
                <textarea
                  className="flex-1 bg-white border border-zinc-300 rounded-md p-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 resize-none disabled:opacity-50"
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
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-4 py-2 rounded-md transition self-end"
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
            />

            <div className="flex flex-col" style={{ width: "45%" }}>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
                Tutor
              </label>

              {/* Earned Concept card — shown only after diagnose-commit succeeds */}
              <ConceptCardPlaceholder
                conceptRevealed={conceptRevealed}
                diagnosisResult={diagnosisResult}
              />

              {/*
                TODO (Step 8): Add retrospective panel here, shown when
                sessionSummary is set (i.e. after a correct fix verdict).
                Data available: hypothesisHistory, sessionSummary.
              */}

              <ChatHistory
                conversationHistory={conversationHistory}
                isLoading={isLoading}
                chatEndRef={chatEndRef}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}