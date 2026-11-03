/**
 * The recording bars mark from docs/brand: five flat bars hanging from one line, lengths
 * 3, 8, 13, 8, 3 on a 24 unit grid. It takes the current text color, so it inverts with the
 * theme and follows the system colors in forced-colors mode. The only ornament in the app.
 */
export function Mark({ size = 20, className }: { size?: number; className?: string }) {
  const lengths = [3, 8, 13, 8, 3];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {lengths.map((length, index) => (
        <rect key={index} x={5 + index * 3} y={6} width={2} height={length} fill="currentColor" />
      ))}
    </svg>
  );
}
