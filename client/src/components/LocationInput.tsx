"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { hasGoogleMapsApiKey, loadGoogleMapsPlaces } from "@/lib/googleMaps";
import { inputClassName } from "@/lib/ui";

interface LocationInputProps {
  value: string[];
  onChange: (locations: string[]) => void;
  disabled?: boolean;
  id?: string;
}

/**
 * Multi-value location input. When a Places API key is configured, a Google
 * `PlaceAutocompleteElement` (the current, non-deprecated widget — the old
 * `Autocomplete` class is legacy and requires enabling a different Cloud API)
 * lets the user search and select a real, properly-formatted place. A
 * separate plain-text field covers entries that aren't real places at all
 * (e.g. "Remote", "Hybrid") — the Google widget only ever resolves to actual
 * places, so it can't accept those.
 */
export default function LocationInput({ value, onChange, disabled, id }: LocationInputProps) {
  // Build-time constant (NEXT_PUBLIC_ env) — derive once instead of
  // re-calling the helper at every render site.
  const placesEnabled = hasGoogleMapsApiKey();
  const containerRef = useRef<HTMLDivElement>(null);
  const autocompleteElRef = useRef<google.maps.places.PlaceAutocompleteElement | null>(null);
  const [customDraft, setCustomDraft] = useState("");
  const [placesReady, setPlacesReady] = useState(false);

  // The gmp-select listener below is registered once, so it must read the
  // latest value/onChange through a ref — capturing them directly would
  // freeze the list at whatever it was when the widget mounted.
  const addLocationRef = useRef(addLocation);
  addLocationRef.current = addLocation;

  useEffect(() => {
    if (!placesEnabled) return;
    let cancelled = false;
    loadGoogleMapsPlaces()
      .then(() => {
        if (!cancelled) setPlacesReady(true);
      })
      .catch((err) => console.error("Failed to load Google Maps Places:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!placesReady || !containerRef.current || autocompleteElRef.current) return;

    const autocompleteEl = new google.maps.places.PlaceAutocompleteElement({
      placeholder: "Start typing a city…",
    });
    autocompleteEl.addEventListener("gmp-select", async (event) => {
      try {
        const { place } = await event.placePrediction.toPlace().fetchFields({
          fields: ["formattedAddress", "displayName"],
        });
        const label = place.formattedAddress ?? place.displayName;
        if (label) addLocationRef.current(label);
      } catch (err) {
        console.error("Failed to resolve selected place:", err);
      } finally {
        autocompleteEl.value = "";
      }
    });

    containerRef.current.appendChild(autocompleteEl);
    autocompleteElRef.current = autocompleteEl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placesReady]);

  useEffect(() => {
    if (autocompleteElRef.current) autocompleteElRef.current.disabled = Boolean(disabled);
  }, [disabled]);

  function addLocation(label: string) {
    const trimmed = label.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
  }

  function removeLocation(label: string) {
    onChange(value.filter((l) => l !== label));
  }

  function handleCustomKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addLocation(customDraft);
      setCustomDraft("");
    }
  }

  return (
    <div>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((loc) => (
            <li
              key={loc}
              className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
            >
              {loc}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeLocation(loc)}
                  className="text-gray-400 hover:text-gray-700"
                  aria-label={`Remove ${loc}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {placesEnabled && <div ref={containerRef} id={id} className="[&>*]:w-full" />}

      <input
        type="text"
        value={customDraft}
        onChange={(e) => setCustomDraft(e.target.value)}
        onKeyDown={handleCustomKeyDown}
        disabled={disabled}
        id={placesEnabled ? undefined : id}
        placeholder={
          placesEnabled ? "Not a real place? Type it here (e.g. Remote)…" : "e.g. New York, NY or Remote"
        }
        className={`mt-2 w-full ${inputClassName}`}
      />
      <p className="mt-1 text-xs text-gray-400">
        Press Enter to add. You can add more than one location.
      </p>
    </div>
  );
}
