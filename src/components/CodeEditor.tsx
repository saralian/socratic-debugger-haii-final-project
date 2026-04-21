"use client";

import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}

export default function CodeEditor({
  value,
  onChange,
  readOnly = false,
  height = "400px",
}: CodeEditorProps) {
  return (
    <div className="rounded-md overflow-hidden border border-zinc-700">
      <CodeMirror
        value={value}
        height={height}
        theme={oneDark}
        extensions={[python()]}
        editable={!readOnly}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          autocompletion: false, // beginners shouldn't get autocomplete crutch
        }}
      />
    </div>
  );
}