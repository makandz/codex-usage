type IconProps = {
  name: 'chart' | 'info';
};

/**
 * Render a decorative dashboard icon, leaving its accessible label to the caller.
 * @param props Icon name to display.
 * @returns Inline SVG matching the surrounding text color.
 */
export function Icon({ name }: IconProps) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'chart' && (
        <>
          <path d="M5 18v-5m7 5V7m7 11V3" />
          <path d="M3 22h18" />
        </>
      )}
      {name === 'info' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6m0-10h.01" />
        </>
      )}
    </svg>
  );
}
