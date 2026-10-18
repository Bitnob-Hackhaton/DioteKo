import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { KycAutoAuditPanel } from "@/components/console/KycAutoAuditPanel";
import { api } from "@/lib/api";
import { resetMockKycDb } from "@/lib/mocks-kyc";
import type { KycAutoAuditView } from "@/lib/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const mount = async (view: KycAutoAuditView) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<KycAutoAuditPanel view={view} />);
  });
  return host;
};

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

const SANDBOX = "Fournisseur en mode bac à sable : résultat non fiable pour la production";

describe("KycAutoAuditPanel", () => {
  it("shows the neutral banner, the face similarity against its threshold and the sandbox warning", async () => {
    resetMockKycDb();
    api.impersonate("u-reg");
    const detail = await api.getKycReview("kyc-6");
    const el = await mount(detail.autoAudit!);

    expect(el.textContent).toContain("Vérifié automatiquement");
    expect(el.textContent).toContain(SANDBOX);
    expect(el.textContent).toContain("90,5 %");
    expect(el.textContent).toContain("seuil 55 %");
    expect(el.textContent).toContain("Preuve de vie");
    // Champ par champ : le nom du champ et son résultat, jamais sa valeur.
    expect(el.textContent).toContain("Date de naissance");
    expect(el.textContent).toContain("Concordance recto / verso");
    expect(el.querySelector("table")).not.toBeNull();
  });

  it("shows no sandbox warning when the provider was not in sandbox mode", async () => {
    resetMockKycDb();
    const detail = await api.getKycReview("kyc-6");
    const el = await mount({
      state: "available",
      audit: { ...detail.autoAudit!.audit!, isSandbox: false },
    });
    expect(el.textContent).toContain("Vérifié automatiquement");
    expect(el.textContent).not.toContain(SANDBOX);
  });

  it("says plainly that nothing is kept for an older dossier, instead of an empty form", async () => {
    const el = await mount({ state: "unavailable", audit: null });
    expect(el.textContent).toContain("Vérifié automatiquement");
    expect(el.textContent).toContain("Aucun détail n'est conservé pour ce dossier.");
    expect(el.textContent).not.toContain(SANDBOX);
    expect(el.querySelector("table")).toBeNull();
  });

  it("never shows a personal value: no name, no number, no OCR table", async () => {
    resetMockKycDb();
    const detail = await api.getKycReview("kyc-6");
    const el = await mount(detail.autoAudit!);
    expect(el.textContent).not.toMatch(/Valeur lue|2000|SN\d|HOLDER/);
  });
});
