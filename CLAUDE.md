# Socratic Debugging Tutor

A web-based debugging tutor for beginner programmers. The student submits buggy code along with what they observe happening when they run it, then forms a hypothesis about the cause. An LLM guides them toward refining that hypothesis through Socratic questioning — without ever revealing the fix or naming the underlying concept up front. The student does the actual debugging and the actual diagnosis.

## Tech stack
- Next.js 15 (App Router, TypeScript, Tailwind CSS)
- CodeMirror 6 via `@uiw/react-codemirror` with `xcodeLight` theme
- Anthropic Claude API (claude-sonnet-4-20250514) via `/api/tutor` route
- Lightweight per-user JSON store for cross-session memory (see Cross-session memory)
- Deployed on Vercel

## Project structure
```
src/
  app/
    page.tsx          # main app — all UI state lives here for now
    layout.tsx
    globals.css
    api/
      tutor/
        route.ts      # LLM API route (server-side, key never in browser)
  components/
    CodeEditor.tsx    # CodeMirror wrapper component
  lib/
    memory.ts         # read/write per-user session summaries
    # samples.ts     # (not yet implemented) canned code samples for Predict-Observe-Explain
prompts.md            # system prompts for each API mode
```

## Default seed code
The Submit screen pre-loads a `find_max` function with an off-by-one error in its loop range (`range(1, len(numbers) - 1)` instead of `range(1, len(numbers))`), causing logic error. This makes a clean demo case: the symptom is a logic error, the bug is in a loop boundary, and the concept name (off-by-one error) is not obvious from the error message alone.

To change the seed code, update the `SEED_CODE` constant at the top of `page.tsx`.

## Core design constraints — NEVER VIOLATE

**1. Never reveal the fix.** The tutor must never reveal the corrected code or state the fix directly. No code snippets showing the answer, no "try changing X to Y", no pseudocode of the fix.

**2. Never collapse the diagnosis step.** The tutor must not hand the student the name of the underlying concept at the start of Diagnose. The concept vocabulary is only introduced as a reveal *after* the student has articulated the underlying mechanism in their own words. Naming the concept up front skips the very step the tutor exists to train.

These two constraints are the central Human-AI interaction design decisions of the project and must be preserved in all generated code, prompts, and UI copy.

## Phase model
The app has three phases, stored in a `phase` state variable:
- `'submit'` — student pastes code, optionally describes what the code should do, and describes what's actually happening when they run it; clicks "Start debugging"
- `'diagnose'` — student forms a Working Hypothesis about the cause, then refines it through Socratic dialogue; ends when the student commits ("I think I've got it"), the tutor validates understanding and names the concept in chat, and the phase advances to Fix
- `'fix'` — student edits code, can converse with the tutor for guidance, and submits attempted fixes for evaluation; ends when the fix is correct, at which point the retrospective panel replaces the right column

Phases advance linearly (submit → diagnose → fix). No going back.

### Submit phase, in detail
The Submit phase captures two things before diagnosis: the code itself, and the student's observation of what the code is actually doing. Separating observation (captured here) from hypothesis (captured in Diagnose) is an intentional pedagogical split — experts observe behavior before theorizing about cause, and the UI should make that split visible rather than collapsing both steps into one confusing form.

- **Your code** — CodeMirror editor, required.
- **What should this code do?** — free-text field, **optional**. When the expected behavior is obvious from context (e.g. a function named `average`), requiring this adds friction without much pedagogical gain.
- **What's happening when you run it?** — free-text field, **required**, with a row of tappable scaffolding chips that populate the field with a starter sentence the student can then edit. Chips use plain-language symptom phrasing only — never error-type vocabulary (syntax/runtime/logic), which is reserved for the post-session reflection prompt. Suggested chip set:
  - *"It's giving unexpected output"*
  - *"It crashes with an error"*
  - *"It runs forever / freezes"*
  - *"It doesn't compile / won't run at all"*
  - *"I'm not sure"*

The **"I'm not sure" chip at Submit** is distinct from the **"I'm not sure" button on the Working Hypothesis card** in Diagnose. At Submit it means "I can't characterize the symptoms." At Diagnose it means "I can't theorize about the cause." The tutor's `diagnose-init` response should be aware of which (or both) the student selected, and handle observation-level uncertainty with a different opening move than cause-level uncertainty — e.g. asking the student to run the code and describe what they see before moving into hypothesis work.

### Diagnose phase, in detail
The Diagnose phase is anchored by the **Working Hypothesis card** at the top of the tutor panel. Its job is to make the student's evolving mental model the central artifact of the session, rather than the tutor's diagnosis.

- On entry to Diagnose, the card shows the student's observed behavior from Submit as read-context (editable inline), and asks a single focused question: *"What do you think might be causing this?"* A persistent "I'm not sure" button sits beside the submit action — this is a legitimate, non-demeaning path at the cause-hypothesis level, and the tutor responds with a narrowing question rather than a concept announcement.
- The observed behavior display is editable inline. If the student's initial observation was itself wrong (e.g. they said "wrong output" when actually an exception was being silently swallowed), the tutor may gently guide them to correct it early in the session, and the student can update it by clicking the displayed text. The hypothesis card's current-observed-behavior value is what's passed to the tutor API, not the original value captured at Submit.
- Once submitted, the hypothesis is pinned to the top of the tutor panel. The student can edit it at any time, and the tutor may offer to revise it based on what the student says in chat ("Want to update your hypothesis based on what you just said?").
- Every revision is kept in a stack. The current hypothesis is shown; previous versions are accessible via an expandable control.
- If the student's hypothesis is wildly wrong, the tutor triggers **Predict-Observe-Explain** using a canned sample from `lib/samples.ts` — a small, runnable-looking code block presented in chat, with a prediction prompt. Samples are conversational only in the current scope (no execution); the tutor knows the output because it's part of the canned example.
- The phase ends when the student clicks **"I think I've got it."** This presents the current hypothesis for confirmation with Confirm or Keep working options. On Confirm, the tutor evaluates the articulation. If sufficient, the tutor names the concept in a chat message and the phase advances to Fix. If not, the tutor pushes back gently and the student stays in Diagnose.

### Retrospective panel
When the student submits a correct fix, the retrospective panel **replaces the entire right column** of the Fix phase. It shows two things: (1) a "What you learned" summary drawn from the `fix-eval` `conceptSummary` field, styled in emerald to signal success; and (2) the student's hypothesis arc displayed as a vertical timeline. This is the session's distilled artifact and the primary CTA gap-analysis data source.

### Fix phase, in detail
The Fix phase has a split layout matching Diagnose: code panels on the left, tutor panel on the right.

**Left column (code panels):**
- Original code panel (read-only, with bug line highlight) unchanged from Diagnose
- Working copy editor highlighted with an emerald label ("Your working copy — apply your fix here") and `ring-1 ring-emerald-300` border to signal the active editing target
- "Reset to original" button in the working copy label row — two-step confirmation (click → "Reset to original?" with Yes/Cancel) to prevent accidental resets
- "Submit fix" button below the editor

**Right column (tutor panel) — two states:**
- *Fix in progress*: frozen Working Hypothesis card (read-only) as a reference for what to fix; chat history; chat input so the student can ask follow-up questions
- *Fix complete*: the entire right column is replaced by the retrospective panel


## Key state variables
- `phase`: 'submit' | 'diagnose' | 'fix'
- `code`: string — student's current editable code (changes as they edit)
- `originalCode`: string — snapshot taken at Submit, never mutated after
- `studentIntent`: string — optional "what should this code do" field
- `observedBehavior`: string — required "what's happening when you run it" field, captured at Submit and editable inline on the Working Hypothesis card in Diagnose
- `conversationHistory`: { role: 'tutor' | 'student', content: string }[]
- `workingHypothesis`: { possibleCause: string } | null — current hypothesis about the cause; null before first submission or if the student chose "I'm not sure" at the hypothesis step
- `hypothesisHistory`: { possibleCause: string, timestamp: number }[] — ordered stack of every committed revision
- `hypothesisCommitted`: boolean — true after "I think I've got it" is confirmed and validated
- `diagnosisResult`: { lineNumber, conceptName, conceptBlurb, observationUnsure } | null — what the tutor has internally determined; used to guide questioning; **never displayed directly to the student**
- `sessionSummary`: string | null — generated at session end for storage in cross-session memory
- `userId`: string — browser-local UUID identifying the user for memory storage
- `isLoading`: boolean
- `draftHypothesis`: { possibleCause: string } — local draft for the hypothesis form; kept separate from `workingHypothesis` so edits don't overwrite the committed hypothesis until the student saves
- `hypothesisCardEditing`: boolean — true when the hypothesis card is in form/editing mode; false when pinned

## API route — /api/tutor
- Server-side only. Anthropic API key lives in `.env.local` as `ANTHROPIC_API_KEY`
- Accepts POST with `{ mode, code, originalCode, studentIntent, observedBehavior, conversationHistory, workingHypothesis, hypothesisHistory, diagnosisResult, userId }`
- Returns structured JSON — see `prompts.md` for exact output schemas per mode
- Modes (one system prompt each):
  - `diagnose-init` — called when the student first submits code; receives `observedBehavior` along with the code and optional intent; returns internal `diagnosisResult` (not shown to student) plus `hypothesisPrompt` — a single neutral sentence shown above the hypothesis card that acknowledges the observation without leading toward the answer
  - `diagnose-hypothesis` — called when the student submits or revises a hypothesis, or sends a chat message; receives the current `observedBehavior` (which may have been edited since Submit); returns the tutor's Socratic response and, if applicable, a flag to trigger Predict-Observe-Explain with a sample ID
  - `diagnose-unsure` — called when the student clicks "I'm not sure" on the hypothesis card; returns a narrowing question to help them form a hypothesis through dialogue
  - `diagnose-commit` — called when the student clicks "I think I've got it" and confirms; evaluates whether articulation is sufficient; if yes, returns a tutor message naming the concept in chat (no separate UI card); if no, returns a gentle pushback and the student stays in Diagnose
  - `fix-eval` — evaluates the student's attempted fix
  - `session-summary` — end-of-session call that produces the 2-3 sentence summary stored in cross-session memory, plus the one-line retrospective summary shown in the retrospective panel

## Cross-session memory
Lightweight per-user memory, implemented as a JSON file per user keyed by `userId` (browser-local UUID for the pilot; easy to swap for real auth later).

- Storage location: `data/users/{userId}.json` (gitignored)
- Schema per user: `{ sessions: SessionSummary[] }` where `SessionSummary = { timestamp, bugCategory, finalHypothesis, fixSuccessful, summary }`
- At session end, `session-summary` mode generates `summary` (2-3 sentences: concept involved, how understanding evolved, any patterns worth remembering)
- At session start, the last 3-5 summaries are loaded and injected into the system prompt under a clearly labeled "Previous session context" section
- Abstraction lives in `lib/memory.ts` — the rest of the app never touches the filesystem directly

### How the tutor is allowed to use memory
This rule is enforced via system prompt, not just convention:

- **Allowed:** referencing shared history around concepts ("we've worked on this pattern before", "this reminds me of the loop termination we discussed last time")
- **Not allowed:** characterizing the student ("you always struggle with loops", "you tend to miss edge cases")

Shared history supports the student. Characterization labels them. The distinction is the whole point of personalization being pedagogical rather than surveillant.

## Component architecture
All sub-components are defined as **top-level functions outside `Home`** to maintain stable React component identity across renders. Defining components inside `Home` causes unmount/remount on every keystroke, destroying input focus. The key top-level components are:

- `InlineEditBlock` — reusable click-to-edit block used for both "What's happening" and "Your hypothesis" in the pinned hypothesis card. Manages its own `isEditing` / `draft` state.
- `WorkingHypothesisCard` — the hypothesis card in all three visual states (skeleton, form/editing, pinned). Receives all needed state and handlers as props.
- `RevisionStack` — expandable previous-version history shown below the pinned hypothesis.
- `RetrospectivePanel` — the session recap shown after a correct fix, replacing the right column.
- `ChatHistory`, `CodePanels`, `ConceptCardPlaceholder` (removed) — other top-level components.

Never define stateful components inside `Home` or inside another component function.

## Styling conventions
- Light theme throughout — bg-zinc-50 backgrounds, zinc-900 text
- Primary action buttons: emerald-600
- Original code panel (read-only): bg-zinc-100 container, visually distinct from editable panel
- Tutor chat bubbles: bg-blue-50 border border-blue-100, left-aligned
- Student chat bubbles: bg-emerald-50 border border-emerald-100, right-aligned
- Working Hypothesis card: pinned at top of tutor panel, visually distinct from chat bubbles; use a neutral card style (bg-white with border-zinc-200) so it reads as "artifact" not "message"
- Observed behavior context on the hypothesis card: rendered as a small labeled block at the top of the card, clickable to edit inline; use a subtle treatment (e.g. bg-zinc-50 border-zinc-200) so it reads as context for the hypothesis field below, not as the primary input
- Scaffolding chips on the Submit screen: rendered as a horizontal row of tappable pills above the "What's happening" textarea; neutral styling (bg-white border-zinc-300 hover:border-zinc-400, small rounded pill shape); tapping a chip populates the textarea with the chip's phrasing
- "I'm not sure" button: persistent, visible beside the hypothesis submit — styled as a secondary button (not ghost/tertiary), to signal legitimacy
- Working copy in Fix phase: emerald label text and `ring-1 ring-emerald-300` border to signal active editing target
- Retrospective panel: bg-white border-zinc-200 outer card; "What you learned" section uses bg-emerald-50 border-emerald-100; hypothesis arc uses zinc neutral tones with emerald dot for the final committed entry
- Reset to original button: text-xs text-zinc-400, in the working copy label row; two-step confirmation before executing
- No dark mode

## What to preserve when making changes
1. The `originalCode` / `code` split — these must stay as separate state variables
2. The "Submit fix" button lives below the editable code panel (left side), not in the chat
3. Error type vocabulary (syntax/runtime/logic) is introduced post-session only, as a reflection prompt — never as a front-loaded gate. This applies to the scaffolding chips too: chips describe symptoms in plain language, not error types.
4. All LLM API calls go through `/api/tutor` — never call the Anthropic API from client-side code
5. The Working Hypothesis card is the anchor of Diagnose and appears frozen (read-only) in Fix as a reference — do not remove it or make it editable in Fix
6. Concept vocabulary is introduced through the tutor's chat message at the end of Diagnose, never as a front-loaded UI card
7. The "I'm not sure" path must remain a first-class, non-demeaning option, available both at Submit (for observation) and at Diagnose (for cause hypothesis)
8. Observation and hypothesis are pedagogically distinct steps. Observation is captured at Submit (required, with chips). Hypothesis is captured at Diagnose (single field, asks about cause only). Do not collapse them back into a single form.
9. Memory prompts must follow the shared-history-not-characterization rule
10. The retrospective panel replaces the entire right column on correct fix — do not show it inline alongside other Fix-phase content

## Scope discipline
This section exists so implementation sessions don't drift into reach-goal work before the must-haves are solid.

**Complete (implemented):**
- Three-phase flow with hypothesis-driven Diagnose
- Submit phase with required observed-behavior field and scaffolding chips (plus "I'm not sure" chip)
- Working Hypothesis card with editable observation context, single cause field, "I'm not sure" button, revision stack, and "I think I've got it" commitment flow
- Frozen hypothesis card in Fix phase as read-only reference
- Chat input in Fix phase for student follow-up questions
- Working copy highlight and reset button in Fix phase
- Socratic chat that responds to the hypothesis
- Concept vocabulary introduced through tutor chat message (no separate UI card)
- Hypothesis revision stack (expandable previous versions)
- End-of-session retrospective panel (replaces right column on correct fix)
- Within-session memory (conversation history passed back to the API)

**Complete (implemented) — added since last update:**
- Cross-session memory write (`session-summary` → `lib/memory.ts` → `data/users/{userId}.json`)
- Cross-session memory read (`buildSessionContext` injected as `previousSessionContext` into all Diagnose mode payloads at session start)

**Reach goals (future work, post-pilot):**
- Predict-Observe-Explain with canned samples — `lib/samples.ts` not yet created; `diagnose-hypothesis` already returns `predictObserveExplain` and `sampleId` flags for when this is built
- Pyodide integration for runnable samples and deterministic variable traces
- Deeper pedagogical personalization that actively adapts question style based on history
- Real authentication replacing browser-local UUIDs
- Variable trace visualization (deferred pending reliable execution backbone)