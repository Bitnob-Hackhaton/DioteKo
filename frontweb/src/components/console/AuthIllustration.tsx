/**
 * Decorative illustration for the sign-in page: a certificate sheet with its seal and QR block,
 * linked by a thin chain to a Lightning node and a verification check. Pure SVG, no external asset;
 * hidden from assistive technology because it carries no information.
 */
export function AuthIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 400"
      className={className}
      role="presentation"
      aria-hidden="true"
      focusable="false"
      fill="none"
    >
      <defs>
        <pattern id="auth-dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.2" fill="currentColor" opacity="0.18" />
        </pattern>
        <linearGradient id="auth-sheet" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      <rect width="480" height="400" fill="url(#auth-dots)" />

      {/* chain between the three figures */}
      <path
        d="M150 250 C 210 330, 300 330, 350 270"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.5"
        strokeDasharray="4 6"
      />
      <path
        d="M270 120 C 330 110, 370 150, 380 205"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.5"
        strokeDasharray="4 6"
      />

      {/* certificate sheet */}
      <g transform="rotate(-4 170 170)">
        <rect
          x="70"
          y="60"
          width="210"
          height="270"
          rx="10"
          fill="url(#auth-sheet)"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="1.5"
        />
        <rect x="94" y="86" width="96" height="9" rx="3" fill="currentColor" opacity="0.7" />
        <rect x="94" y="108" width="140" height="6" rx="3" fill="currentColor" opacity="0.35" />
        <rect x="94" y="124" width="120" height="6" rx="3" fill="currentColor" opacity="0.35" />
        <rect x="94" y="140" width="132" height="6" rx="3" fill="currentColor" opacity="0.35" />
        <rect x="94" y="156" width="84" height="6" rx="3" fill="currentColor" opacity="0.35" />

        {/* seal */}
        <circle
          cx="236"
          cy="262"
          r="28"
          stroke="currentColor"
          strokeOpacity="0.7"
          strokeWidth="1.5"
        />
        <circle
          cx="236"
          cy="262"
          r="20"
          stroke="currentColor"
          strokeOpacity="0.4"
          strokeWidth="1"
        />
        <path
          d="M226 262 l7 7 l13 -15"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* QR block */}
        <g fill="currentColor" opacity="0.8">
          <rect x="94" y="226" width="14" height="14" />
          <rect x="112" y="226" width="14" height="14" opacity="0.4" />
          <rect x="130" y="226" width="14" height="14" />
          <rect x="94" y="244" width="14" height="14" opacity="0.4" />
          <rect x="112" y="244" width="14" height="14" />
          <rect x="130" y="244" width="14" height="14" opacity="0.4" />
          <rect x="94" y="262" width="14" height="14" />
          <rect x="112" y="262" width="14" height="14" opacity="0.4" />
          <rect x="130" y="262" width="14" height="14" />
        </g>
      </g>

      {/* lightning node */}
      <g transform="translate(350 270)">
        <circle r="38" fill="currentColor" opacity="0.1" />
        <circle r="38" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.5" />
        <path d="M6 -22 L-12 4 H-1 L-6 22 L12 -4 H1 Z" fill="currentColor" opacity="0.9" />
      </g>

      {/* verification check */}
      <g transform="translate(380 190)">
        <circle r="26" fill="currentColor" opacity="0.1" />
        <circle r="26" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.5" />
        <path
          d="M-11 0 l8 8 l15 -17"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}
