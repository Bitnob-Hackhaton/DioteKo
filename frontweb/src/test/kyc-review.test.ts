import { beforeEach, describe, expect, it } from "vitest";
import { api } from "@/lib/api";
import { resetMockKycDb } from "@/lib/mocks-kyc";

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
  });
});
