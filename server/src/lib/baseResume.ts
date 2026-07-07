import { prisma } from "./prisma";

/**
 * The user's current resume is their most recently uploaded one (BaseResume
 * rows are append-only). Both the Settings page and the resume-tips
 * staleness check must agree on this definition, so it lives in one place.
 */
export function getLatestBaseResume(userId: string) {
  return prisma.baseResume.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}
