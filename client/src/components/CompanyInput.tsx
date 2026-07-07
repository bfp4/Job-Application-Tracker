"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { inputClassName } from "@/lib/ui";

interface CompanySuggestion {
  name: string;
  domain: string;
}

interface CompanyInputProps {
  value: string;
  onChange: (name: string) => void;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}

/**
 * Free-text company name input with autocomplete suggestions from Clearbit's
 * unauthenticated autocomplete endpoint (CORS-enabled, no API key). Falls
 * back silently to plain text entry if the request fails.
 */
export default function CompanyInput({ value, onChange, disabled, required, id }: CompanyInputProps) {
  const [suggestions, setSuggestions] = useState<CompanySuggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : []))
        .then((data: CompanySuggestion[]) => {
          setSuggestions(data);
          setHighlightedIndex(-1);
        })
        .catch((err) => {
          if (err.name !== "AbortError") console.error("Failed to fetch company suggestions:", err);
        });
    }, 200);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectSuggestion(suggestion: CompanySuggestion) {
    onChange(suggestion.name);
    setIsOpen(false);
    setSuggestions([]);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!isOpen || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlightedIndex]);
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        id={id}
        type="text"
        required={required}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        autoComplete="off"
        className={`w-full ${inputClassName}`}
      />
      {isOpen && suggestions.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white text-sm shadow-lg">
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.domain}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectSuggestion(suggestion)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left hover:bg-gray-50 ${
                  index === highlightedIndex ? "bg-gray-50" : ""
                }`}
              >
                <span className="text-gray-900">{suggestion.name}</span>
                <span className="text-xs text-gray-400">{suggestion.domain}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
