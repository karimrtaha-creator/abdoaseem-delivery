/**
 * The signature hero mascot: the koshary container with arms and legs.
 * One loop (8s, matches --mascot-cycle so every animated piece stays in
 * phase): spins three times, lands with a little bounce, raises an arm to
 * point at the hotline number, holds so it's actually readable, then
 * relaxes and pauses before the next spin.
 */
export function KosharyBox() {
  return (
    <div className="mascot-wrap" aria-hidden="true">
      <svg viewBox="0 0 240 320" className="mascot-svg">
        <g className="mascot-steam">
          <path className="steam-line steam-1" d="M96 44 C 90 32, 102 24, 96 12" />
          <path className="steam-line steam-2" d="M120 38 C 114 26, 126 18, 120 6" />
          <path className="steam-line steam-3" d="M144 44 C 138 32, 150 24, 144 12" />
        </g>

        {/* legs - static, planted, so the spin above reads as the body
            twirling in place rather than the whole character toppling */}
        <g stroke="var(--color-lentil)" strokeWidth="14" strokeLinecap="round">
          <path d="M104 226 L 96 268" />
          <path d="M136 226 L 144 268" />
        </g>
        <ellipse cx="94" cy="274" rx="14" ry="7" fill="var(--color-lentil)" />
        <ellipse cx="146" cy="274" rx="14" ry="7" fill="var(--color-lentil)" />

        {/* resting arm (the one that does NOT point) */}
        <path
          d="M78 168 C 54 178, 46 200, 52 220"
          stroke="var(--color-lentil)"
          strokeWidth="13"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="52" cy="222" r="9" fill="var(--color-lentil)" />

        {/* the spinning/bouncing body - matches the real container: yellow
            cup, red "ABDO ASEEM" label band, macaroni-lentil base with
            chickpeas at the rim, tomato dagga poured center-right, two
            crispy-onion crescents, a lime wedge on top */}
        <g className="mascot-body">
          <circle cx="120" cy="140" r="90" fill="var(--color-cup)" stroke="var(--color-cup-dark)" strokeWidth="6" />
          <circle cx="120" cy="140" r="78" fill="var(--color-base-mix)" />

          {/* chickpeas around the rim - drawn before the sauce so the sauce
              covers the ones under it, leaving the rest visible at the edge
              exactly like the photo */}
          <g fill="var(--color-chickpea)">
            <circle cx="120" cy="64" r="4.5" />
            <circle cx="95" cy="68" r="4" />
            <circle cx="145" cy="68" r="4" />
            <circle cx="70" cy="80" r="4.5" />
            <circle cx="170" cy="80" r="4.5" />
            <circle cx="53" cy="102" r="4" />
            <circle cx="187" cy="102" r="4" />
            <circle cx="46" cy="130" r="4.5" />
            <circle cx="194" cy="130" r="4.5" />
            <circle cx="50" cy="160" r="4" />
            <circle cx="190" cy="160" r="4" />
            <circle cx="62" cy="186" r="4.5" />
            <circle cx="178" cy="186" r="4.5" />
            <circle cx="90" cy="204" r="4" />
            <circle cx="150" cy="204" r="4" />
          </g>

          {/* tomato dagga, poured center-right - offset from the base
              circle's center so the base + chickpeas still peek out at the
              lower-left, same as the reference photo */}
          <ellipse cx="134" cy="122" rx="65" ry="61" fill="var(--color-tomato)" />

          {/* two crispy-onion crescents across the sauce */}
          <path
            d="M84 108 Q 112 90, 140 106"
            stroke="var(--color-onion)"
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M100 140 Q 132 118, 166 138"
            stroke="var(--color-onion)"
            strokeWidth="9"
            strokeLinecap="round"
            fill="none"
          />

          {/* lime wedge on top */}
          <path d="M118 90 A 16 16 0 0 1 150 90 Z" fill="var(--color-lime)" stroke="#fff" strokeWidth="2" />
          <path d="M134 90 L 134 78 M134 90 L 122 82 M134 90 L 146 82" stroke="#fff" strokeWidth="1.5" opacity="0.7" />

          {/* the front label band */}
          <rect x="52" y="196" width="136" height="30" rx="8" fill="var(--color-tomato-dark)" />
          <text
            x="120"
            y="216"
            textAnchor="middle"
            fontFamily="var(--font-body)"
            fontWeight="800"
            fontSize="13"
            letterSpacing="0.03em"
            fill="#fff"
          >
            ABDO ASEEM
          </text>
        </g>

        {/* the pointing arm - pivots from the shoulder toward the hotline badge */}
        <g className="mascot-arm-point" style={{ transformOrigin: "168px 172px" }}>
          <path
            d="M168 172 C 192 176, 206 164, 210 144"
            stroke="var(--color-lentil)"
            strokeWidth="13"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="210" cy="142" r="9" fill="var(--color-lentil)" />
        </g>
      </svg>

      <div className="hotline-badge">
        <span className="hotline-label">اتصل بينا</span>
        <span className="hotline-number">19860</span>
      </div>
    </div>
  );
}
