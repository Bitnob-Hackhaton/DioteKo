## Architecture rules
- All server access goes through `src/lib/api.ts`; mocks in `src/lib/mocks.ts` sit behind it (VITE_USE_MOCKS) so screens never change when the real API is wired.
- Permissions live only in `src/lib/permissions.ts` (consumed by `<Can>`, `<Guard>`, `useCan`) — one matrix, so UI and route guards cannot drift.
- Console pages live under the pathless `_console` layout, which owns the session check and app shell.
- Routing is TanStack Router (file-based), not React Router.
- The console never shows or downloads a certificate PDF: the document belongs to the holder. Personal data shown to staff is limited to what the role needs.
