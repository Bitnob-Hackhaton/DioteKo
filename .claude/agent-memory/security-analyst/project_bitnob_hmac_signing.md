---
name: bitnob-hmac-signing
description: How the backend-nest Bitnob outbound HMAC request signing works and the sign-what-you-send invariant it must preserve
metadata:
  type: project
---

`backend-nest/src/modules/bitnob/services/bitnob-hmac.util.ts` +
`bitnob-http-client.service.ts` sign every outbound Bitnob API call.

**Scheme (must match `bitnob_api.postman_collection.json` collection-level prerequest script):**
- `stringToSign = ${clientId}:${timestampSeconds}:${nonceHex}:${payloadString}`
- `signature = hex(HMAC-SHA256(stringToSign, clientSecret))`
- headers: `X-Auth-Client`, `X-Auth-Timestamp`, `X-Auth-Nonce`, `X-Auth-Signature`, `Content-Type: application/json`
- nonce = 16 random bytes hex (32 chars); timestamp = `Math.floor(Date.now()/1000)`
- Postman signs the compact body string (`JSON.stringify(JSON.parse(raw))`), NOT key-sorted. GET / no body signs `""`. `finalize` sends and signs `"{}"`.
- The `client_secret` is ONLY ever the HMAC key — never sent as a header/body/query param, so it cannot appear in a Bitnob response or `BitnobApiError.responseBody`.
- Bitnob signature does NOT cover the URL query string.

**Invariant that keeps breaking / must be guarded:** signed bytes == wire bytes.
The approved design makes `buildAuthHeaders` sign an exact
`payloadString` and `bitnob-http-client` send that same string via
`axios.post(path, payload, { transformRequest: [(d) => d] })`. With that identity
`transformRequest`, axios's default JSON transform is bypassed, so
`buildAuthHeaders` returning `Content-Type: application/json` is load-bearing
(axios `defaults.headers.post` is `{}`; nothing else sets it).

**How to apply:** Any change here — reject it unless one `const payload` string is
used for BOTH the signature and the axios send, `Content-Type` is still returned,
and there is a test cross-checking the hex signature the Postman way. Inbound
webhook signature verification is a separate mechanism: `BitnobWebhookSignatureGuard`
(`bitnob/guards/bitnob-webhook-signature.guard.ts`, HMAC-SHA512 over the raw body, compared with `crypto.timingSafeEqual`).
Related: [[backend-nest-rewrite]].
