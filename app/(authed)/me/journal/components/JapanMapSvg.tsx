export function JapanMapSvg({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 500 280" className={className} aria-label="日本群岛抽象图">
      <defs>
        <filter id="watercolor">
          <feTurbulence baseFrequency="0.02" numOctaves="2" result="t" />
          <feDisplacementMap in="SourceGraphic" in2="t" scale="5" />
        </filter>
      </defs>
      <path
        d="M 360 30 Q 410 25 430 50 Q 440 75 415 85 Q 380 90 365 70 Q 355 50 360 30 Z"
        fill="#e6d7b8" stroke="#4a4236" strokeWidth="1" filter="url(#watercolor)" opacity="0.7"
      />
      <path
        d="M 130 120 Q 160 110 200 115 Q 240 115 280 130 Q 320 145 345 170 Q 360 195 340 210 Q 300 215 260 200 Q 220 195 180 180 Q 150 170 130 150 Z"
        fill="#e6d7b8" stroke="#4a4236" strokeWidth="1" filter="url(#watercolor)" opacity="0.7"
      />
      <path
        d="M 95 200 Q 115 195 130 210 Q 140 230 125 245 Q 105 250 90 235 Q 85 215 95 200 Z"
        fill="#e6d7b8" stroke="#4a4236" strokeWidth="1" filter="url(#watercolor)" opacity="0.7"
      />
      <path
        d="M 175 195 Q 200 192 215 205 Q 215 218 195 220 Q 175 218 175 195 Z"
        fill="#e6d7b8" stroke="#4a4236" strokeWidth="1" filter="url(#watercolor)" opacity="0.7"
      />
    </svg>
  )
}
