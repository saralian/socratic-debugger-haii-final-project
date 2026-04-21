"use client";

import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { xcodeLight } from "@uiw/codemirror-theme-xcode";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { StateField, RangeSetBuilder } from "@codemirror/state";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  highlightLine?: number | null;
}

const lineHighlightMark = Decoration.line({ class: "cm-highlighted-line" });

function buildHighlightExtension(lineNumber: number) {
  return StateField.define<DecorationSet>({
    create(state) {
      const builder = new RangeSetBuilder<Decoration>();
      const clamped = Math.min(Math.max(lineNumber, 1), state.doc.lines);
      const line = state.doc.line(clamped);
      builder.add(line.from, line.from, lineHighlightMark);
      return builder.finish();
    },
    update(value) {
      return value;
    },
    provide(f) {
      return EditorView.decorations.from(f);
    },
  });
}

export default function CodeEditor({
  value,
  onChange,
  readOnly = false,
  height = "400px",
  highlightLine = null,
}: CodeEditorProps) {
  const highlightExtension = useMemo(
    () => (highlightLine != null ? [buildHighlightExtension(highlightLine)] : []),
    [highlightLine]
  );

  return (
    <div className="rounded-md overflow-hidden border border-zinc-700">
      <CodeMirror
        value={value}
        height={height}
        theme={xcodeLight}
        extensions={[python(), ...highlightExtension]}
        editable={!readOnly}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          autocompletion: false,
        }}
      />
    </div>
  );
}
