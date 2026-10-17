import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import { routeTree } from "@/routeTree.gen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const text = () => document.body.textContent ?? "";
const until = async (cond: () => boolean, ms = 6000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
  }
};

// Reproduit : tableau de bord -> clic sur « Demandes » -> la page ne doit pas tomber sur l'écran d'erreur racine.
describe("Console navigation", () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = "";
  });

  it("opens /demandes from the dashboard without the root error screen", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // jsdom has no scrollIntoView; give it one that returns a value, as a real browser/extension may. An effect
    // that returned this call's result made React throw "destroy is not a function" on unmount.
    // React's own warning for the failing case says the effect returned a Promise, so return one.
    Element.prototype.scrollIntoView = (() =>
      Promise.resolve()) as unknown as typeof Element.prototype.scrollIntoView;
    // jsdom has no ResizeObserver either (Radix Select/Sheet use it).
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    await auth.impersonate("u-reg");

    const router = createRouter({
      routeTree,
      context: { queryClient: new QueryClient() },
      history: createMemoryHistory({ initialEntries: ["/tableau-de-bord"] }),
    });
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<RouterProvider router={router} />);
    });
    await until(() => /Tableau de bord/i.test(text()));

    // Visit twice: on the second visit the list is already cached, so the rows (and their refs) exist on the
    // first commit and the scroll effect runs on mount. Leaving the page runs the effect cleanups.
    for (let visit = 0; visit < 2; visit++) {
      await act(async () => {
        await router.navigate({ to: "/demandes" });
      });
      // "Page N sur M" is always rendered; wait for real rows so the next visit starts from a warm cache.
      await until(() => document.querySelectorAll("li button").length > 0);
      expect(document.querySelectorAll("li button").length).toBeGreaterThan(0);
      await act(async () => {
        await router.navigate({ to: "/tableau-de-bord" });
      });
      await until(() => /Tableau de bord/i.test(text()));
    }

    const effectErrors = errors.mock.calls.filter((c) =>
      /destroy is not a function|useEffect must not return/.test(c.map(String).join(" ")),
    );
    expect(effectErrors).toHaveLength(0);
    expect(text()).not.toMatch(/n'a pas pu être chargée/);
  }, 30000);
});
