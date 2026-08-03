import { Router, type Request, type Response } from "express";
import type { User } from "@prisma/client";
import { authenticate, requireAdmin } from "../middleware/auth";
import { DAILY_BASIC_LIMIT, effectiveAiCallsUsedToday } from "../middleware/quota";
import { prisma } from "../lib/prisma";
import { asyncHandler } from "../lib/http";

const router = Router();

router.use(authenticate, requireAdmin);

/**
 * The only columns the admin grid needs. Explicit (rather than a bare query)
 * so firebaseUid can never ride along in a response — same rule the
 * /api/user serializer follows.
 */
const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  tier: true,
  createdAt: true,
  aiCallsUsedToday: true,
  aiCallsDate: true,
} as const;

type AdminUserRow = Pick<User, keyof typeof ADMIN_USER_SELECT>;

/**
 * A row of the admin user grid: quota exposed as "calls left" rather than the
 * raw counters, so the client never has to know about the lazy daily reset.
 * Every route returning a user goes through this, so the shape can't drift
 * between the list and the mutations that update rows in it.
 */
function serializeAdminUser(user: AdminUserRow, hasPendingPremiumRequest: boolean) {
  const { aiCallsUsedToday, aiCallsDate, ...rest } = user;
  return {
    ...rest,
    aiCallsRemaining:
      user.tier === "BASIC"
        ? Math.max(
            0,
            DAILY_BASIC_LIMIT - effectiveAiCallsUsedToday({ aiCallsUsedToday, aiCallsDate })
          )
        : null,
    hasPendingPremiumRequest,
  };
}

export const DEFAULT_USERS_PAGE_SIZE = 25;
/** Ceiling on ?limit — one page still has to be a sane query and payload. */
export const MAX_USERS_PAGE_SIZE = 100;
/**
 * Ceiling on ?page. Any page past the end of the data is empty whatever the
 * number, so this isn't about the answer being right — it's that `skip` has
 * to stay inside the 32-bit integer Prisma accepts. Above that the query
 * throws instead of returning the empty page that was asked for, and a
 * nonsense URL 500s. 100k pages of 100 covers ten million users.
 */
export const MAX_USERS_PAGE = 100_000;

/**
 * Reads a positive integer query param, clamped to [1, max]. Clamps rather
 * than 400s: these come from the admin UI's own controls, and a nonsense
 * ?limit is better answered with a page of users than with an error. Both
 * params need a real ceiling and not just a sane default — see MAX_USERS_PAGE
 * for why an unbounded ?page isn't harmless the way an unbounded ?limit
 * would be.
 */
function parsePageParam(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/**
 * GET /api/admin/users?page=1&limit=25&search=
 * One page of users with their tier, for the admin page's user grid.
 *
 * Paginated (rather than returning the table) so the query and the grid stay
 * bounded as signups accumulate. `search` is applied server-side for the same
 * reason — filtering client-side would only ever search the current page.
 */
router.get(
  "/users",
  asyncHandler(async (req: Request, res: Response) => {
    const limit = parsePageParam(req.query.limit, DEFAULT_USERS_PAGE_SIZE, MAX_USERS_PAGE_SIZE);
    const page = parsePageParam(req.query.page, 1, MAX_USERS_PAGE);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    const where = search
      ? { email: { contains: search, mode: "insensitive" as const } }
      : {};

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * limit,
        take: limit,
        select: ADMIN_USER_SELECT,
      }),
    ]);

    // Scoped to this page's users — the unfiltered version grew with every
    // pending request in the system regardless of what was being displayed.
    const pendingRequests = await prisma.premiumRequest.findMany({
      where: { status: "PENDING", userId: { in: users.map((u) => u.id) } },
      select: { userId: true },
    });
    const pendingUserIds = new Set(pendingRequests.map((r) => r.userId));

    res.json({
      users: users.map((user) => serializeAdminUser(user, pendingUserIds.has(user.id))),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  })
);

/**
 * PATCH /api/admin/users/:id/tier
 * Upgrades or downgrades a user between BASIC and PREMIUM. ADMIN is never
 * settable through this route — only by direct DB edit — so the sole-admin
 * account can't be changed (or duplicated) through the UI.
 */
router.patch(
  "/users/:id/tier",
  asyncHandler(async (req: Request, res: Response) => {
    const { tier } = req.body ?? {};
    if (tier !== "BASIC" && tier !== "PREMIUM") {
      res.status(400).json({ error: "`tier` must be \"BASIC\" or \"PREMIUM\"." });
      return;
    }

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    if (target.tier === "ADMIN") {
      res.status(403).json({ error: "Admin tier cannot be changed here." });
      return;
    }

    // Granting PREMIUM directly (instead of via the Requests-tab approve
    // flow) should still resolve any pending request the user has, so it
    // doesn't sit in the queue forever and the "Requested premium" badge
    // doesn't linger — same transaction shape as the approve/deny route.
    const [user] = await prisma.$transaction([
      prisma.user.update({ where: { id: target.id }, data: { tier }, select: ADMIN_USER_SELECT }),
      ...(tier === "PREMIUM"
        ? [
            prisma.premiumRequest.updateMany({
              where: { userId: target.id, status: "PENDING" },
              data: { status: "APPROVED" as const, resolvedAt: new Date() },
            }),
          ]
        : []),
    ]);

    // Return the recomputed row, not just an ack: a downgrade to BASIC makes
    // quota relevant again, and the client has no way to derive the count
    // (a PREMIUM row carries aiCallsRemaining: null). Upgrading resolved any
    // pending request in the transaction above; a downgrade leaves one
    // standing, so that case has to ask.
    const pending =
      tier === "BASIC"
        ? await prisma.premiumRequest.findFirst({
            where: { userId: target.id, status: "PENDING" },
            select: { id: true },
          })
        : null;

    res.json({ user: serializeAdminUser(user, Boolean(pending)) });
  })
);

/**
 * GET /api/admin/premium-requests
 * Lists premium requests, defaulting to just the unresolved ones for the
 * admin page's review queue. Pass ?status=all to see everything.
 */
router.get(
  "/premium-requests",
  asyncHandler(async (req: Request, res: Response) => {
    const showAll = req.query.status === "all";
    const requests = await prisma.premiumRequest.findMany({
      where: showAll ? {} : { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, email: true } } },
    });
    res.json({ requests });
  })
);

/**
 * PATCH /api/admin/premium-requests/:id
 * Approves (tier -> PREMIUM) or denies a pending request.
 *
 * Approving an ADMIN's own stale request resolves it without writing the
 * tier: admins are made by direct DB edit, so a user can be promoted while an
 * old request of theirs is still PENDING, and a blind update to PREMIUM would
 * silently demote them — with a sole admin, locking everyone out of this
 * router with no way back in through the UI. Granting premium to someone who
 * already has more than premium is a no-op anyway; the request is genuinely
 * satisfied, so it's marked APPROVED rather than refused.
 */
router.patch(
  "/premium-requests/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { action } = req.body ?? {};
    if (action !== "approve" && action !== "deny") {
      res.status(400).json({ error: '`action` must be "approve" or "deny".' });
      return;
    }

    const request = await prisma.premiumRequest.findUnique({ where: { id: req.params.id } });
    if (!request) {
      res.status(404).json({ error: "Premium request not found." });
      return;
    }
    if (request.status !== "PENDING") {
      res.status(409).json({ error: "This request has already been resolved." });
      return;
    }

    const target = await prisma.user.findUnique({
      where: { id: request.userId },
      select: { tier: true },
    });
    const grantsTier = action === "approve" && target?.tier !== "ADMIN";

    const [updatedRequest] = await prisma.$transaction([
      prisma.premiumRequest.update({
        where: { id: request.id },
        data: {
          status: action === "approve" ? "APPROVED" : "DENIED",
          resolvedAt: new Date(),
        },
      }),
      ...(grantsTier
        ? [prisma.user.update({ where: { id: request.userId }, data: { tier: "PREMIUM" as const } })]
        : []),
    ]);

    res.json({ request: updatedRequest });
  })
);

export default router;
