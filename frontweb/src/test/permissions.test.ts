import { describe, expect, it } from "vitest";
import { can, violatesFourEyes } from "@/lib/permissions";
import type { OrgRole } from "@/lib/types";

const u = (roles: OrgRole[], platformRole?: "super_admin") => ({ roles, platformRole });

describe("permissions", () => {
  it("only approvers may issue", () => {
    expect(can(u(["approver"]), "request.issue")).toBe(true);
    expect(can(u(["registrar"]), "request.issue")).toBe(false);
    expect(can(u(["org_owner"]), "request.issue")).toBe(false);
  });
  it("only registrars may recommend", () => {
    expect(can(u(["registrar"]), "request.recommend")).toBe(true);
    expect(can(u(["approver"]), "request.recommend")).toBe(false);
  });
  it("auditor has no note permission", () => {
    expect(can(u(["auditor"]), "request.note")).toBe(false);
  });
  it("org switch is super-admin only", () => {
    expect(can(u([], "super_admin"), "org.switch")).toBe(true);
    expect(can(u(["org_owner"]), "org.switch")).toBe(false);
  });
  it("only approvers may revoke a certificate", () => {
    expect(can(u(["approver"]), "certificate.revoke")).toBe(true);
    expect(can(u(["org_owner"]), "certificate.revoke")).toBe(false);
    expect(can(u(["auditor"]), "certificate.revoke")).toBe(false);
  });
  it("four-eyes blocks the recommender", () => {
    expect(violatesFourEyes("a", "a")).toBe(true);
    expect(violatesFourEyes("a", "b")).toBe(false);
  });
});

describe("kyc review", () => {
  it("only registrars and approvers may review identity documents", () => {
    expect(can(u(["registrar"]), "kyc.review")).toBe(true);
    expect(can(u(["approver"]), "kyc.review")).toBe(true);
    expect(can(u(["org_owner"]), "kyc.review")).toBe(false);
    expect(can(u(["finance_officer"]), "kyc.review")).toBe(false);
    expect(can(u(["auditor"]), "kyc.review")).toBe(false);
    expect(can(u([], "super_admin"), "kyc.review")).toBe(false);
  });
});

describe("personal data policy", () => {
  it("only registrars and approvers see the holder's personal data", () => {
    expect(can(u(["registrar"]), "request.view_personal_data")).toBe(true);
    expect(can(u(["approver"]), "request.view_personal_data")).toBe(true);
    expect(can(u(["finance_officer"]), "request.view_personal_data")).toBe(false);
    expect(can(u(["org_owner"]), "request.view_personal_data")).toBe(false);
    expect(can(u(["auditor"]), "request.view_personal_data")).toBe(false);
    expect(can(u([], "super_admin"), "request.view_personal_data")).toBe(false);
  });
});
