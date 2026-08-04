/**
 * The hero image: a static koshary container matching the real product -
 * yellow cup, red "ABDO ASEEM" label band, macaroni-lentil base with
 * chickpeas at the rim, tomato dagga poured center-right, two crispy-onion
 * crescents, a lime wedge on top - with the hotline number underneath.
 * No animation: the earlier spinning/pointing mascot was cut on request.
 */
export function KosharyBox() {
  return (
    <div className="koshary-static" aria-hidden="true">
      <svg viewBox="0 0 240 240" className="koshary-static-svg">
        <circle cx="120" cy="120" r="90" fill="var(--color-cup)" stroke="var(--color-cup-dark)" strokeWidth="6" />
        <circle cx="120" cy="120" r="78" fill="var(--color-base-mix)" />

        {/* chickpeas around the rim - drawn before the sauce so the sauce
            covers the ones under it, leaving the rest visible at the edge
            exactly like the photo */}
        <g fill="var(--color-chickpea)">
          <circle cx="120" cy="44" r="4.5" />
          <circle cx="95" cy="48" r="4" />
          <circle cx="145" cy="48" r="4" />
          <circle cx="70" cy="60" r="4.5" />
          <circle cx="170" cy="60" r="4.5" />
          <circle cx="53" cy="82" r="4" />
          <circle cx="187" cy="82" r="4" />
          <circle cx="46" cy="110" r="4.5" />
          <circle cx="194" cy="110" r="4.5" />
          <circle cx="50" cy="140" r="4" />
          <circle cx="190" cy="140" r="4" />
          <circle cx="62" cy="166" r="4.5" />
          <circle cx="178" cy="166" r="4.5" />
          <circle cx="90" cy="184" r="4" />
          <circle cx="150" cy="184" r="4" />
        </g>

        {/* tomato dagga, poured center-right - offset from the base circle's
            center so the base + chickpeas still peek out at the lower-left,
            same as the reference photo */}
        <ellipse cx="134" cy="102" rx="65" ry="61" fill="var(--color-tomato)" />

        {/* two crispy-onion crescents across the sauce */}
        <path d="M84 88 Q 112 70, 140 86" stroke="var(--color-onion)" strokeWidth="9" strokeLinecap="round" fill="none" />
        <path d="M100 120 Q 132 98, 166 118" stroke="var(--color-onion)" strokeWidth="9" strokeLinecap="round" fill="none" />

        {/* lime wedge on top */}
        <path d="M118 70 A 16 16 0 0 1 150 70 Z" fill="var(--color-lime)" stroke="#fff" strokeWidth="2" />
        <path d="M134 70 L 134 58 M134 70 L 122 62 M134 70 L 146 62" stroke="#fff" strokeWidth="1.5" opacity="0.7" />

        {/* the front label band */}
        <rect x="52" y="176" width="136" height="30" rx="8" fill="var(--color-tomato-dark)" />
        <text
          x="120"
          y="196"
          textAnchor="middle"
          fontFamily="var(--font-body)"
          fontWeight="800"
          fontSize="13"
          letterSpacing="0.03em"
          fill="#fff"
        >
          ABDO ASEEM
        </text>
      </svg>

      <a className="koshary-hotline" href="tel:19860">
        <span className="hotline-label">للطلب اتصل بينا</span>
        <span className="hotline-number">19860</span>
      </a>
    </div>
  );
}
