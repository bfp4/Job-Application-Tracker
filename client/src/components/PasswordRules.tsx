"use client";

import { PASSWORD_RULES } from "@/lib/authErrors";
import { IconCheck } from "@/components/icons";

/**
 * The live password checklist, ticking off as the user types.
 *
 * Advisory only — the hosted Firebase reset page and the REST API both bypass
 * it, so this guides rather than enforces. Enforcing it would need Identity
 * Platform's password policy, which this project isn't upgraded for.
 */
export default function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="mt-2.5 space-y-1.5">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password);
        return (
          <li
            key={rule.label}
            className={`flex items-center gap-2 text-xs font-medium transition ${
              met ? "text-emerald-600" : "text-muted"
            }`}
          >
            <span
              aria-hidden
              className={`flex h-3.5 w-3.5 items-center justify-center rounded-full ${
                met ? "bg-emerald-600 text-white" : "border border-border"
              }`}
            >
              {met && <IconCheck size={9} strokeWidth={3} />}
            </span>
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
