"use client";

import { useId, useRef, useState } from "react";

type Props = {
  label: string;
  hint: string;
  preview: string | null;
  disabled?: boolean;
  onSelect: (file: File) => void;
  onClear: () => void;
};

export default function UploadZone({
  label,
  hint,
  preview,
  disabled = false,
  onSelect,
  onClear,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onSelect(file);
    // Reset so picking the same file twice still fires onChange.
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={[
          "group relative flex h-[420px] w-full items-center justify-center border bg-well md:h-[560px]",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          dragging ? "border-ink" : "border-hairline",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          onChange={(e) => handleFiles(e.target.files)}
          className="sr-only"
        />

        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt={`${label} preview`}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 text-center">
            <svg
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth="1"
              className="h-8 w-8 text-muted"
            >
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            <span className="text-xs font-bold tracking-widest uppercase">
              Upload
            </span>
            <span className="text-xs text-muted">{hint}</span>
          </div>
        )}
      </label>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs font-bold tracking-widest uppercase">
          {label}
        </span>
        {preview && !disabled && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs tracking-widest text-muted uppercase underline underline-offset-4 hover:text-ink"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
