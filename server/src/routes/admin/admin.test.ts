import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    premiumRequest: {
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.resolve(ops)),
  },
}));

vi.mock("../../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../../middleware/auth/auth", () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: "admin-1", tier: "ADMIN" } as never;
    next();
  },
  requireAdmin: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import adminRouter, { MAX_USERS_PAGE } from "./admin";

const app = express();
app.use(express.json());
app.use("/api/admin", adminRouter);

describe("GET /api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.premiumRequest.findMany.mockResolvedValue([]);
  });

  /** The paging args the route passed to findMany on the last call. */
  function lastQuery() {
    return prismaMock.user.findMany.mock.calls[0][0];
  }

  it("defaults to the first page of 25", async () => {
    const res = await request(app).get("/api/admin/users");

    expect(res.status).toBe(200);
    expect(lastQuery()).toMatchObject({ skip: 0, take: 25 });
    expect(res.body).toMatchObject({ page: 1, limit: 25 });
  });

  it("honours ?page and ?limit", async () => {
    await request(app).get("/api/admin/users?page=3&limit=10");

    expect(lastQuery()).toMatchObject({ skip: 20, take: 10 });
  });

  it("clamps ?limit to the maximum page size", async () => {
    const res = await request(app).get("/api/admin/users?limit=5000");

    expect(lastQuery()).toMatchObject({ take: 100 });
    expect(res.body.limit).toBe(100);
  });

  // An unbounded ?page isn't harmless the way an unbounded ?limit is: the
  // skip it computes overflows the 32-bit integer Prisma takes, and the query
  // throws rather than returning the empty page that was asked for.
  it("clamps ?page so a huge one yields an empty page instead of a 500", async () => {
    const res = await request(app).get("/api/admin/users?page=100000000&limit=100");

    expect(res.status).toBe(200);
    expect(lastQuery().skip).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(res.body.page).toBe(MAX_USERS_PAGE);
  });

  it("falls back to the default for a nonsense ?limit or ?page", async () => {
    const res = await request(app).get("/api/admin/users?limit=abc&page=0");

    expect(lastQuery()).toMatchObject({ skip: 0, take: 25 });
    expect(res.body).toMatchObject({ page: 1, limit: 25 });
  });

  it("filters by email server-side, so search spans every page", async () => {
    await request(app).get("/api/admin/users?search=%20ADA%20");

    const where = { email: { contains: "ADA", mode: "insensitive" } };
    expect(lastQuery()).toMatchObject({ where });
    // The count has to use the same filter or the page numbers lie.
    expect(prismaMock.user.count).toHaveBeenCalledWith({ where });
  });

  it("looks up pending requests only for the users on this page", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: "user-1", email: "a@example.com", tier: "BASIC", createdAt: new Date() },
      { id: "user-2", email: "b@example.com", tier: "PREMIUM", createdAt: new Date() },
    ]);
    prismaMock.premiumRequest.findMany.mockResolvedValue([{ userId: "user-2" }]);
    prismaMock.user.count.mockResolvedValue(2);

    const res = await request(app).get("/api/admin/users");

    expect(prismaMock.premiumRequest.findMany).toHaveBeenCalledWith({
      where: { status: "PENDING", userId: { in: ["user-1", "user-2"] } },
      select: { userId: true },
    });
    expect(res.body.users[0].hasPendingPremiumRequest).toBe(false);
    expect(res.body.users[1].hasPendingPremiumRequest).toBe(true);
  });

  it("reports totalPages from the filtered count", async () => {
    prismaMock.user.count.mockResolvedValue(51);

    const res = await request(app).get("/api/admin/users?limit=25");

    expect(res.body).toMatchObject({ total: 51, totalPages: 3 });
  });

  it("reports one page when there are no users at all", async () => {
    const res = await request(app).get("/api/admin/users");

    expect(res.body).toMatchObject({ total: 0, totalPages: 1 });
  });
});

describe("PATCH /api/admin/users/:id/tier", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upgrading to PREMIUM also resolves the user's pending request in the same transaction", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", tier: "BASIC" });
    prismaMock.user.update.mockReturnValue({ id: "user-1", tier: "PREMIUM" });
    prismaMock.premiumRequest.updateMany.mockReturnValue({ count: 1 });

    const res = await request(app)
      .patch("/api/admin/users/user-1/tier")
      .send({ tier: "PREMIUM" });

    expect(res.status).toBe(200);
    expect(prismaMock.premiumRequest.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", status: "PENDING" },
      data: { status: "APPROVED", resolvedAt: expect.any(Date) },
    });
  });

  it("downgrading to BASIC does not touch premium requests", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", tier: "PREMIUM" });
    prismaMock.user.update.mockReturnValue({ id: "user-1", tier: "BASIC" });

    const res = await request(app)
      .patch("/api/admin/users/user-1/tier")
      .send({ tier: "BASIC" });

    expect(res.status).toBe(200);
    expect(prismaMock.premiumRequest.updateMany).not.toHaveBeenCalled();
  });

  it("returns the recomputed row on downgrade, so the client needn't derive quota", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", tier: "PREMIUM" });
    prismaMock.user.update.mockReturnValue({
      id: "user-1",
      email: "u@example.com",
      tier: "BASIC",
      createdAt: new Date(),
      aiCallsUsedToday: 4,
      aiCallsDate: new Date(),
    });
    prismaMock.premiumRequest.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/admin/users/user-1/tier")
      .send({ tier: "BASIC" });

    expect(res.status).toBe(200);
    // A PREMIUM row carries aiCallsRemaining: null, so the client can't derive
    // this itself — it has to come back from the update.
    expect(res.body.user.aiCallsRemaining).toBe(6);
    expect(res.body.user.hasPendingPremiumRequest).toBe(false);
    expect(res.body.user).not.toHaveProperty("aiCallsUsedToday");
  });

  it("reports a still-pending request after a downgrade", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", tier: "PREMIUM" });
    prismaMock.user.update.mockReturnValue({ id: "user-1", tier: "BASIC" });
    prismaMock.premiumRequest.findFirst.mockResolvedValue({ id: "req-1" });

    const res = await request(app)
      .patch("/api/admin/users/user-1/tier")
      .send({ tier: "BASIC" });

    expect(res.body.user.hasPendingPremiumRequest).toBe(true);
  });

  it("selects an explicit field set, so the response can't leak firebaseUid", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", tier: "BASIC" });
    prismaMock.user.update.mockReturnValue({ id: "user-1", tier: "PREMIUM" });
    prismaMock.premiumRequest.updateMany.mockReturnValue({ count: 0 });

    await request(app).patch("/api/admin/users/user-1/tier").send({ tier: "PREMIUM" });

    const select = prismaMock.user.update.mock.calls[0][0].select;
    expect(select).toBeDefined();
    expect(select).not.toHaveProperty("firebaseUid");
  });

  it("rejects an invalid tier", async () => {
    const res = await request(app)
      .patch("/api/admin/users/user-1/tier")
      .send({ tier: "ADMIN" });

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("404s for an unknown user", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/admin/users/nope/tier")
      .send({ tier: "PREMIUM" });

    expect(res.status).toBe(404);
  });

  it("refuses to change an ADMIN user's tier", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "user-1", tier: "ADMIN" });

    const res = await request(app)
      .patch("/api/admin/users/user-1/tier")
      .send({ tier: "PREMIUM" });

    expect(res.status).toBe(403);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/premium-requests/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.premiumRequest.findUnique.mockResolvedValue({
      id: "req-1",
      userId: "user-1",
      status: "PENDING",
    });
    prismaMock.premiumRequest.update.mockReturnValue({ id: "req-1", status: "APPROVED" });
    prismaMock.user.findUnique.mockResolvedValue({ tier: "BASIC" });
  });

  it("approving grants PREMIUM in the same transaction that resolves the request", async () => {
    const res = await request(app)
      .patch("/api/admin/premium-requests/req-1")
      .send({ action: "approve" });

    expect(res.status).toBe(200);
    expect(prismaMock.premiumRequest.update).toHaveBeenCalledWith({
      where: { id: "req-1" },
      data: { status: "APPROVED", resolvedAt: expect.any(Date) },
    });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { tier: "PREMIUM" },
    });
  });

  it("denying resolves the request without touching the tier", async () => {
    await request(app).patch("/api/admin/premium-requests/req-1").send({ action: "deny" });

    expect(prismaMock.premiumRequest.update).toHaveBeenCalledWith({
      where: { id: "req-1" },
      data: { status: "DENIED", resolvedAt: expect.any(Date) },
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  // Admins are made by direct DB edit, so a promoted user can still have a
  // PENDING request from before. Writing PREMIUM here would demote them — and
  // with a sole admin, lock everyone out of this router.
  it("approving an ADMIN's stale request resolves it without demoting them", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ tier: "ADMIN" });

    const res = await request(app)
      .patch("/api/admin/premium-requests/req-1")
      .send({ action: "approve" });

    expect(res.status).toBe(200);
    expect(prismaMock.premiumRequest.update).toHaveBeenCalledWith({
      where: { id: "req-1" },
      data: { status: "APPROVED", resolvedAt: expect.any(Date) },
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("409s a request that was already resolved", async () => {
    prismaMock.premiumRequest.findUnique.mockResolvedValue({
      id: "req-1",
      userId: "user-1",
      status: "APPROVED",
    });

    const res = await request(app)
      .patch("/api/admin/premium-requests/req-1")
      .send({ action: "approve" });

    expect(res.status).toBe(409);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
