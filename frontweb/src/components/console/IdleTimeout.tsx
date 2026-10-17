import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { auth } from "@/lib/auth";

const IDLE_MS = 15 * 60_000;
const WARN_MS = 60_000;

export function IdleTimeout() {
  const [warn, setWarn] = useState(false);
  const [left, setLeft] = useState(60);
  const last = useRef(Date.now());

  useEffect(() => {
    const bump = () => {
      if (!warn) last.current = Date.now();
    };
    const evs = ["mousemove", "keydown", "mousedown", "scroll"] as const;
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= IDLE_MS) void auth.logout("idle");
      else if (idle >= IDLE_MS - WARN_MS) {
        setWarn(true);
        setLeft(Math.ceil((IDLE_MS - idle) / 1000));
      }
    }, 1000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [warn]);

  return (
    <AlertDialog open={warn}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Session inactive</AlertDialogTitle>
          <AlertDialogDescription>
            Vous serez déconnecté dans {left} secondes faute d'activité.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => void auth.logout()}>Se déconnecter</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              last.current = Date.now();
              setWarn(false);
            }}
          >
            Rester connecté
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
