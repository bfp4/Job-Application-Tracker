import Link from "next/link";

/**
 * Links to the two legal documents. Rendered on the signed-out pages
 * (AuthLayout) and at the bottom of every signed-in page (AppShell), because
 * both audiences need to be able to find them without hunting.
 */
export default function LegalFooter({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs font-medium text-muted ${className}`}>
      <Link href="/privacy" className="hover:text-ink">
        Privacy Policy
      </Link>
      <span className="px-1.5">·</span>
      <Link href="/terms" className="hover:text-ink">
        Terms of Service
      </Link>
    </p>
  );
}
