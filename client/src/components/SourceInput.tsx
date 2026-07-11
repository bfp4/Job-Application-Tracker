"use client";

import { useId } from "react";
import { inputClassName } from "@/lib/ui";

const SOURCE_SUGGESTIONS = [
  "LinkedIn",
  "Indeed",
  "Glassdoor",
  "Company website",
  "Referral",
  "Recruiter",
  "Job board",
  "Career fair",
];

interface SourceInputProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  id?: string;
}

/**
 * Free-text input for where the user found the job, with a datalist of
 * common sources.
 */
export default function SourceInput({ value, onChange, onBlur, disabled, id }: SourceInputProps) {
  const listId = useId();

  return (
    <>
      <input
        id={id}
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        placeholder="e.g. LinkedIn, referral…"
        className={`w-full ${inputClassName}`}
      />
      <datalist id={listId}>
        {SOURCE_SUGGESTIONS.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </>
  );
}
