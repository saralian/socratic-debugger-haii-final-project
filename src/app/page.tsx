"use client";

import { useState, useRef, useEffect } from "react";
import CodeEditor from "@/components/CodeEditor";

type Phase = "submit" | "diagnose" | "fix";

interface Message {
  role: "tutor" | "student";
  content: string;
}

interface DiagnosisResult {
  lineNumber: number;
  conceptName: string;
  conceptBlurb: string;
  openingQuestion: string;
  internalBugSummary: string;
}

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

export default function Home() {
  const [phase, setPhase] = useState<Phase>("submit");
  const [code, setCode] = useState(SEED_CODE);
  const [originalCode, setOriginalCode] = useState("");
  const [studentIntent, setStudentIntent] = useState("");
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnosisResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [studentReply, setStudentReply] = useState("");
  const [conceptSummary, setConceptSummary] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationHistory, isLoading]);

  // ── API call ───────────────────────────────────────────────────────────────

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

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleStartDebugging() {
    const snapshot = code;
    setOriginalCode(snapshot);
    setPhase("diagnose");

    const data = await callTutorAPI({ phase: "diagnose", code: snapshot, studentIntent, conversationHistory: [] });
    if (!data) return;

    const result: DiagnosisResult = {
      lineNumber: data.lineNumber as number,
      conceptName: data.conceptName as string,
      conceptBlurb: data.conceptBlurb as string,
      openingQuestion: data.openingQuestion as string,
      internalBugSummary: data.internalBugSummary as string,
    };
    setDiagnosisResult(result);
    setConversationHistory([{ role: "tutor", content: result.openingQuestion }]);
  }

  async function handleSendReply() {
    if (!studentReply.trim() || isLoading) return;

    const studentMsg: Message = { role: "student", content: studentReply.trim() };
    const updatedHistory = [...conversationHistory, studentMsg];
    setConversationHistory(updatedHistory);
    setStudentReply("");

    const data = await callTutorAPI({
      phase: "diagnose",
      code,
      originalCode,
      studentIntent,
      conversationHistory: updatedHistory,
      diagnosisResult,
    });
    if (!data) return;

    const tutorMsg: Message = { role: "tutor", content: data.tutorMessage as string };
    setConversationHistory((prev) => [...prev, tutorMsg]);

    if (data.studentState === "ready_to_fix") {
      setPhase("fix");
    }
  }

  async function handleSubmitFix() {
    if (isLoading) return;

    const data = await callTutorAPI({
      phase: "fix",
      code,
      originalCode,
      studentIntent,
      conversationHistory,
      diagnosisResult,
    });
    if (!data) return;

    const tutorMsg: Message = { role: "tutor", content: data.tutorMessage as string };
    setConversationHistory((prev) => [...prev, tutorMsg]);

    if (data.verdict === "correct" && data.conceptSummary) {
      setConceptSummary(data.conceptSummary as string);
    }
  }

  // ── Shared sub-components ──────────────────────────────────────────────────

  function ConceptCard() {
    return (
      <div className="bg-white border border-zinc-200 rounded-md p-4 mb-4">
        {diagnosisResult ? (
          <>
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">
              Concept
            </div>
            <div className="text-sm font-semibold text-zinc-800 mb-1">
              {diagnosisResult.conceptName}
            </div>
            <p className="text-sm text-zinc-600">{diagnosisResult.conceptBlurb}</p>
          </>
        ) : (
          <>
            <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-1">
              Concept
            </div>
            <p className="text-sm text-zinc-400">Waiting for diagnosis…</p>
          </>
        )}
      </div>
    );
  }

  function ChatHistory() {
    return (
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {conversationHistory.length === 0 && !isLoading && (
          <p className="text-sm text-zinc-400 italic">
            The conversation will appear here once the tutor responds.
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

  function CodePanels({ editable }: { editable: boolean }) {
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
          <CodeEditor value={code} onChange={editable ? setCode : () => {}} readOnly={!editable} height="100%" />
        </div>

        {phase === "fix" && (
          <button
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-md transition"
            onClick={handleSubmitFix}
            disabled={isLoading}
          >
            Submit fix
          </button>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

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
          <>
            <header className="mb-6">
              <p className="text-sm text-zinc-500 mt-1">
                Paste your buggy code below. I'll help you find and understand the bug — you'll do the fixing.
              </p>
            </header>

            <section className="mb-4">
              <label className="block text-sm text-zinc-600 mb-2">Your code</label>
              <CodeEditor value={code} onChange={setCode} height="400px" />
            </section>

            <section className="mb-6">
              <label className="block text-sm text-zinc-600 mb-2">
                What should this code do? <span className="text-zinc-400">(optional)</span>
              </label>
              <textarea
                className="w-full bg-white border border-zinc-300 rounded-md p-3 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                rows={2}
                placeholder="e.g. compute the average of a list of numbers"
                value={studentIntent}
                onChange={(e) => setStudentIntent(e.target.value)}
              />
            </section>

            <button
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-md transition"
              onClick={handleStartDebugging}
              disabled={isLoading}
            >
              {isLoading ? "Starting…" : "Start debugging"}
            </button>
          </>
        )}

        {/* ── DIAGNOSE ── */}
        {phase === "diagnose" && (
          <div className="flex gap-6 h-[calc(100vh-120px)]">
            <CodePanels editable />

            <div className="flex flex-col" style={{ width: "45%" }}>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
                Tutor
              </label>
              <ConceptCard />
              <ChatHistory />

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
            <CodePanels editable />

            <div className="flex flex-col" style={{ width: "45%" }}>
              <label className="block text-xs font-medium text-zinc-500 uppercase tracking-wide mb-3">
                Tutor
              </label>
              <ConceptCard />

              {/* Concept summary — shown when fix is correct */}
              {conceptSummary && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 mb-4">
                  <div className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-1">
                    What you learned
                  </div>
                  <p className="text-sm text-emerald-900">{conceptSummary}</p>
                </div>
              )}

              <ChatHistory />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
