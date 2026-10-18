import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { KycAssessmentPanel } from "@/components/console/KycAssessmentPanel";
import { kycConfidenceLevel, kycProviderCodeLabel } from "@/lib/kyc-labels";
import { api } from "@/lib/api";
import { resetMockKycDb } from "@/lib/mocks-kyc";
import type { KycAssessmentView } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const mount = async (view: KycAssessmentView) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<KycAssessmentPanel view={view} />);
  });
  return host;
};

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

const BANNER = "Vérification automatique non concluante — décision manuelle requise";

describe("KycAssessmentPanel", () => {
  it("shows the banner, the reason in French, the OCR fields with a meter each, and the scores", async () => {
    resetMockKycDb();
    api.impersonate("u-reg");
    // Dossier de démonstration n°4 : lecture complète, visage non concordant.
    const detail = await api.getKycReview("kyc-4");
    const el = await mount(detail.assessment!);

    expect(el.textContent).toContain(BANNER);
    expect(el.textContent).toContain("TEST HOLDER B");
    expect(el.textContent).toContain("Nom complet");
    // Une jauge par champ + la confiance globale, lisible par un lecteur d'écran.
    const meters = el.querySelectorAll('[role="meter"]');
    expect(meters.length).toBe(detail.assessment!.assessment!.ocr!.fields.length + 1);
    expect(meters[0]!.getAttribute("aria-valuenow")).toBe("97");
    expect(meters[0]!.getAttribute("aria-label")).toContain("Nom complet");
    // Le mot accompagne la couleur : l'information ne repose pas sur la seule teinte.
    expect(el.textContent).toContain("97 % · Élevée");
    expect(el.textContent).toContain("Visage du selfie / photo de la pièce");
    expect(el.textContent).toContain("41 %");
    expect(el.textContent).toContain("Échec");
  });

  it("says plainly that the automatic check produced no data when the provider read nothing", async () => {
    resetMockKycDb();
    api.impersonate("u-reg");
    const detail = await api.getKycReview("kyc-1");
    const el = await mount(detail.assessment!);

    expect(el.textContent).toContain(BANNER);
    expect(el.textContent).toContain("La vérification automatique n'a produit aucune donnée.");
    expect(el.textContent).toContain("Le recto n'a pas pu être lu");
    expect(el.textContent).toContain("FRONT_OCR_FAILED");
    // Pas de formulaire vide.
    expect(el.querySelector("table")).toBeNull();
  });

  it("says it too when nothing was kept (outage, expired)", async () => {
    const el = await mount({ state: "unavailable", assessment: null });
    expect(el.textContent).toContain(BANNER);
    expect(el.textContent).toContain("La vérification automatique n'a produit aucune donnée.");
    expect(el.querySelector("table")).toBeNull();
  });

  it("does not claim a failed automatic check for a manual-only dossier", async () => {
    const el = await mount({ state: "not_run", assessment: null });
    expect(el.textContent).not.toContain(BANNER);
    expect(el.textContent).toContain("aucun contrôle automatique n'a été effectué");
  });

  it("marks a field without confidence with a dash and a screen-reader text", async () => {
    resetMockKycDb();
    api.impersonate("u-reg");
    const detail = await api.getKycReview("kyc-2");
    const el = await mount(detail.assessment!);
    expect(el.textContent).toContain("Date d'expiration");
    expect(el.querySelector(".sr-only")?.textContent).toBeTruthy();
    expect(el.textContent).toContain("non fournie");
  });
});

describe("KYC labels", () => {
  it("names the provider codes and falls back on keywords, then on the raw code", () => {
    expect(kycProviderCodeLabel("FRONT_OCR_FAILED")).toContain("recto");
    expect(kycProviderCodeLabel("BACK_MRZ_CHECKSUM_FAILED")).toContain("MRZ");
    expect(kycProviderCodeLabel("SOMETHING_LIVENESS_X")).toContain("preuve de vie");
    expect(kycProviderCodeLabel("TOTALLY_NEW")).toBe("Code du prestataire : TOTALLY_NEW");
  });

  it("names the codes of a refusal the agent now arbitrates (cross-validation, forgery, hard rejection)", () => {
    expect(kycProviderCodeLabel("CROSS_VALIDATION_FAILED")).toBe(
      "Le recto et le verso ne concordent pas.",
    );
    expect(kycProviderCodeLabel("FRONT_TAMPER_DETECTED")).toContain("falsification");
    expect(kycProviderCodeLabel("CRITICAL_FIELD_MISMATCH")).toContain("ne concordent pas");
    expect(kycProviderCodeLabel("HARD_REJECTED")).toContain("rejeté définitivement");
    expect(kycProviderCodeLabel("FACE_MATCH_FAILED")).toContain("visage");
    expect(kycProviderCodeLabel("LIVENESS_FAILED")).toContain("preuve de vie");
  });

  it("grades a confidence", () => {
    expect(kycConfidenceLevel(0.9)).toBe("high");
    expect(kycConfidenceLevel(0.7)).toBe("medium");
    expect(kycConfidenceLevel(0.3)).toBe("low");
  });
});
