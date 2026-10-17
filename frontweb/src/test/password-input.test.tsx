import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PasswordInput } from "@/components/ui/password-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

const mount = async (node: React.ReactNode) => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
  });
  return host;
};

const click = async (el: Element) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
};

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("PasswordInput", () => {
  it("hides the value by default and toggles it with the eye button", async () => {
    const el = await mount(<PasswordInput aria-label="Mot de passe" defaultValue="secret" />);
    const input = el.querySelector("input") as HTMLInputElement;
    const toggle = () => el.querySelector("button") as HTMLButtonElement;

    expect(input.type).toBe("password");
    expect(toggle().getAttribute("aria-label")).toBe("Afficher le mot de passe");
    expect(toggle().getAttribute("aria-pressed")).toBe("false");

    await click(toggle());
    expect(input.type).toBe("text");
    expect(toggle().getAttribute("aria-label")).toBe("Masquer le mot de passe");
    expect(toggle().getAttribute("aria-pressed")).toBe("true");

    await click(toggle());
    expect(input.type).toBe("password");
  });

  it("does not submit the surrounding form when the toggle is clicked", async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const el = await mount(
      <form onSubmit={onSubmit}>
        <PasswordInput aria-label="Mot de passe" />
      </form>,
    );
    await click(el.querySelector("button")!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables the toggle together with the field", async () => {
    const el = await mount(<PasswordInput aria-label="Mot de passe" disabled />);
    expect((el.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
