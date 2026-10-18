import { beforeEach, describe, expect, it } from "vitest";
import { api } from "@/lib/api";
import { resetMockKycDb } from "@/lib/mocks-kyc";
import { KYC_ORIGIN_LABELS, KYC_STATUS_FILTER_LABELS } from "@/lib/kyc-labels";
import { KYC_DEFAULT_STATUS, KYC_LIST_STATUSES, parseKycSearch } from "@/lib/kyc-search";

describe("KYC manual review (simulated API)", () => {
  beforeEach(() => {
    resetMockKycDb();
    api.impersonate("u-reg");
  });

  it("lists the dossiers waiting for an agent, oldest first", async () => {
    const list = await api.listKycReviews({});
    expect(list.total).toBe(5);
    expect(list.items.every((r) => r.status === "manual_review")).toBe(true);
    const dates = list.items.map((r) => r.createdAt);
    expect([...dates].sort()).toEqual(dates);
  });

  it("filters by origin", async () => {
    const list = await api.listKycReviews({ origin: "manual_only" });
    expect(list.items.map((r) => r.origin)).toEqual(["manual_only"]);
  });

  it("serves an image for each available document", async () => {
    const [first] = (await api.listKycReviews({})).items;
    const url = await api.getKycDocument(first!.id, "front");
    expect(url.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("refuses a decision without a justification, then approves and refuses a second decision", async () => {
    const [first] = (await api.listKycReviews({})).items;
    await expect(api.decideKycReview(first!.id, "approve", "court")).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      api.decideKycReview(first!.id, "approve", "Nom et selfie concordants."),
    ).resolves.toMatchObject({ status: "verified" });
    await expect(
      api.decideKycReview(first!.id, "reject", "Décision en double, à refuser."),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await api.listKycReviews({})).total).toBe(4);
  });

  it("refuses a role without the permission", async () => {
    api.impersonate("u-owner");
    await expect(api.listKycReviews({})).rejects.toMatchObject({ statusCode: 403 });
    await expect(api.getKycReview("kyc-1")).rejects.toMatchObject({ statusCode: 403 });
  });

  describe("audit of the automatic verifications", () => {
    it("lists them under « Identité validée », newest first, read-only, with the origin « Vérification automatique »", async () => {
      const list = await api.listKycReviews({ status: "verified" });
      expect(list.items.map((r) => r.id)).toEqual(["kyc-6", "kyc-8", "kyc-7"]);
      const auto = list.items.filter((r) => r.origin === "auto");
      expect(auto.map((r) => r.id)).toEqual(["kyc-6", "kyc-7"]);
      expect(KYC_ORIGIN_LABELS.auto).toBe("Vérification automatique");
      // Aucune photo, ni trace ni évaluation dans la liste.
      expect(auto.every((r) => r.availableDocuments.length === 0)).toBe(true);
      expect(list.items.every((r) => r.autoAudit === undefined && r.assessment === undefined)).toBe(
        true,
      );
    });

    it("filters on the origin auto, and finds none among the dossiers to review", async () => {
      expect((await api.listKycReviews({ status: "verified", origin: "auto" })).total).toBe(2);
      expect((await api.listKycReviews({ origin: "auto" })).total).toBe(0);
    });

    it("shows the reduced audit on the detail route, with the sandbox flag, and no OCR text", async () => {
      const detail = await api.getKycReview("kyc-6");
      expect(detail.autoAudit?.state).toBe("available");
      expect(detail.autoAudit?.audit).toMatchObject({
        isSandbox: true,
        faceMatch: { score: 0.905, threshold: 0.55, passed: true },
      });
      expect(detail.assessment).toBeUndefined();
      expect(JSON.stringify(detail)).not.toMatch(/full_name|TEST HOLDER/);
      expect((await api.getKycReview("kyc-7")).autoAudit).toEqual({
        state: "unavailable",
        audit: null,
      });
    });

    it("cannot be decided: the dossier was already validated", async () => {
      await expect(
        api.decideKycReview("kyc-6", "reject", "Je veux rejeter un dossier déjà validé."),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("stays refused to a role without the permission", async () => {
      api.impersonate("u-owner");
      await expect(api.listKycReviews({ status: "all" })).rejects.toMatchObject({
        statusCode: 403,
      });
      await expect(api.getKycReview("kyc-6")).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe("« Tous les états » filter", () => {
    it("lists every state at once, newest first, with each row keeping its own status", async () => {
      const list = await api.listKycReviews({ status: "all" });
      expect(list.total).toBe(9);
      expect(new Set(list.items.map((r) => r.status))).toEqual(
        new Set(["manual_review", "verified", "rejected"]),
      );
      const dates = list.items.map((r) => r.createdAt);
      expect([...dates].sort().reverse()).toEqual(dates);
    });

    it("combines with the origin filter, and the default stays the work queue", async () => {
      const fallback = await api.listKycReviews({ status: "all", origin: "fallback" });
      expect(fallback.items.every((r) => r.origin === "fallback")).toBe(true);
      expect(fallback.items.some((r) => r.status === "verified")).toBe(true);
      const queue = await api.listKycReviews({});
      expect(queue.items.every((r) => r.status === "manual_review")).toBe(true);
    });
  });

  describe("search parameters of the page", () => {
    it("keeps status=all (and the other known values) so the filter survives a reload", () => {
      expect(parseKycSearch({ status: "all" }).status).toBe("all");
      expect(
        parseKycSearch({ status: "verified", origin: "auto", page: "3", id: "kyc-6" }),
      ).toEqual({
        status: "verified",
        origin: "auto",
        page: 3,
        id: "kyc-6",
      });
    });

    it("falls back on the work queue (no status) for an unknown value, never throws", () => {
      expect(parseKycSearch({}).status).toBeUndefined();
      expect(parseKycSearch({ status: "pending", origin: "x", page: "-2", id: "" })).toEqual({
        status: undefined,
        origin: undefined,
        page: undefined,
        id: undefined,
      });
      expect(KYC_DEFAULT_STATUS).toBe("manual_review");
    });

    it("offers « Tous les états » last in the status filter", () => {
      expect(KYC_LIST_STATUSES.at(-1)).toBe("all");
      expect(KYC_STATUS_FILTER_LABELS.all).toBe("Tous les états");
      expect(KYC_STATUS_FILTER_LABELS.manual_review).toBe("À relire");
    });
  });

  describe("automatic-check assessment", () => {
    it("is on the detail route only, never in the list", async () => {
      const list = await api.listKycReviews({});
      expect(list.items.every((r) => r.assessment === undefined)).toBe(true);
      const detail = await api.getKycReview("kyc-4");
      expect(detail.assessment?.state).toBe("available");
    });

    it("covers the four states the agent can meet", async () => {
      const states = await Promise.all(
        ["kyc-1", "kyc-2", "kyc-3", "kyc-4", "kyc-5"].map(
          async (id) => (await api.getKycReview(id)).assessment?.state,
        ),
      );
      expect(states).toEqual(["no_data", "available", "not_run", "available", "unavailable"]);
    });

    it("is gone once the dossier is decided (deleted with the photos)", async () => {
      await api.decideKycReview("kyc-4", "reject", "Visage non concordant avec la pièce.");
      expect((await api.getKycReview("kyc-4")).assessment).toBeUndefined();
    });
  });
});
