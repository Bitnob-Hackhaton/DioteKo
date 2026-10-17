import { createFileRoute, redirect } from "@tanstack/react-router";
import { USE_MOCKS } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DioteKo Console" },
      {
        name: "description",
        content: "Back-office des organisations qui émettent les certificats DioteKo.",
      },
      { property: "og:title", content: "DioteKo Console" },
      {
        property: "og:description",
        content: "Back-office des organisations qui émettent les certificats DioteKo.",
      },
    ],
  }),
  beforeLoad: () => {
    // The dashboard needs statistics the API does not provide yet: the real console opens on the queue.
    throw redirect({ to: USE_MOCKS ? "/tableau-de-bord" : "/demandes" });
  },
});
