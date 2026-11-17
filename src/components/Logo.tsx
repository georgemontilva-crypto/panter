import { useId } from "react";
import { MARK_PATH, MARK_VIEWBOX, WORDMARK_PATH, WORDMARK_VIEWBOX } from "../assets/logo";

export function PantherMark({
  className,
  title,
  lit = false,
}: {
  className?: string;
  title?: string;
  /** Relleno con degradado, como el logo encendido. */
  lit?: boolean;
}) {
  const id = useId();
  return (
    <svg
      className={className}
      viewBox={MARK_VIEWBOX}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {lit && (
        <defs>
          <radialGradient id={id} cx="50%" cy="40%" r="62%">
            <stop offset="0" stopColor="#ff6a45" />
            <stop offset="0.5" stopColor="#ff2b1c" />
            <stop offset="1" stopColor="#c20f18" />
          </radialGradient>
        </defs>
      )}
      <path fill={lit ? `url(#${id})` : "currentColor"} fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}

export function Wordmark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      className={className}
      viewBox={WORDMARK_VIEWBOX}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path fill="currentColor" fillRule="evenodd" d={WORDMARK_PATH} />
    </svg>
  );
}
