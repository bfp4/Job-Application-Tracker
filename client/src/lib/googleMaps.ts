let loadPromise: Promise<void> | null = null;

/**
 * Lazily injects the Google Maps JS API with the Places library, once, and
 * resolves once `google.maps.places` is populated. Callers should check
 * `hasGoogleMapsApiKey()` first — this rejects if no key is configured.
 *
 * Deliberately NOT using `loading=async`: that mode requires Google's inline
 * bootstrap-loader snippet to define `google.maps.importLibrary` before the
 * base script runs, which a plain `<script src="...">` tag doesn't provide —
 * `importLibrary` stays undefined and calling it throws. Requesting
 * `libraries=places` directly in the URL is the older, unconditionally
 * reliable path: the library is attached to `google.maps.places` before the
 * script's `onload` fires. It logs one harmless console recommendation to
 * use `loading=async` instead; that's cosmetic, not a functional issue.
 */
export function loadGoogleMapsPlaces(): Promise<void> {
  if (loadPromise) return loadPromise;

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured."));
  }

  loadPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.places) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Maps."));
    document.head.appendChild(script);
  });

  return loadPromise;
}

export function hasGoogleMapsApiKey(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
}
