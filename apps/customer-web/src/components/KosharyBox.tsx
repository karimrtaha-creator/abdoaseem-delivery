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

        {/* the spinning/bouncing body */}
        <g className="mascot-body">
          <circle cx="120" cy="140" r="88" fill="#fff" stroke="var(--color-onion-dark)" strokeWidth="6" />
          <circle cx="120" cy="140" r="76" fill="#efe4c8" />
          <path d="M50 148 A 70 70 0 0 1 63 98 L 148 148 Z" fill="#6b5238" opacity="0.9" />
          <path d="M63 98 A 70 70 0 0 1 126 70 L 148 148 Z" fill="#c9924a" opacity="0.92" />
          <path d="M126 70 A 70 70 0 0 1 180 108 L 148 148 Z" fill="#d9c08a" opacity="0.95" />
          <path d="M180 108 A 70 70 0 0 1 173 194 A 70 70 0 0 1 72 202 L 120 148 Z" fill="var(--color-tomato)" />
          <g fill="var(--color-onion)">
            <circle cx="148" cy="120" r="4" />
            <circle cx="160" cy="138" r="3" />
            <circle cx="138" cy="148" r="3.5" />
            <circle cx="154" cy="162" r="3" />
            <circle cx="128" cy="172" r="4" />
            <circle cx="110" cy="162" r="3" />
            <circle cx="119" cy="180" r="3.5" />
            <circle cx="96" cy="176" r="3" />
          </g>
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
