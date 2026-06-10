/**
 * Generic labelled grey placeholder box. Used for the testimonial blood
 * reports and the doctor group photo. Pass an extra className for sizing.
 *
 * PHASE 2/3: these get swapped for real <img> assets.
 */
export function ImagePlaceholder({ label, className = '' }) {
  return <div className={`placeholder ${className}`}>{label}</div>
}

/**
 * Responsive 16:9 video placeholder.
 *
 * id="vsl-video" is intentional and load-bearing:
 * PHASE 2 mounts the real player here (seek-bar lock + watch-time tracking).
 */
export function VideoPlaceholder() {
  return (
    <div className="video-frame">
      <div className="placeholder" id="vsl-video">
        <span className="play-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="#6d28d9">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
        <span>[VSL video — Phase 2]</span>
      </div>
    </div>
  )
}
