interface SparklineProps {
  values: number[];
  className?: string;
}

export function Sparkline({ values, className }: SparklineProps) {
  const width = 140;
  const height = 44;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
    const y = height - (value / max) * (height - 4) - 2;
    return `${x},${y}`;
  });

  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Traffic trend">
      <polyline points={points.join(' ')} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
