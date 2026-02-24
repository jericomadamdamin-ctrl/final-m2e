export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';

  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  const units: Array<{ threshold: number; suffix: string }> = [
    { threshold: 1e27, suffix: 'Oc' },
    { threshold: 1e24, suffix: 'Sp' },
    { threshold: 1e21, suffix: 'Sx' },
    { threshold: 1e18, suffix: 'Qi' },
    { threshold: 1e15, suffix: 'Qa' },
    { threshold: 1e12, suffix: 'T' },
    { threshold: 1e9, suffix: 'B' },
    { threshold: 1e6, suffix: 'M' },
    { threshold: 1e3, suffix: 'K' },
  ];

  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    if (abs < unit.threshold) continue;

    const scaled = abs / unit.threshold;
    const decimals = scaled >= 100 ? 0 : 1;
    const rounded = Number(scaled.toFixed(decimals));

    // Avoid awkward outputs like "1000M" by rolling into the next unit.
    if (rounded >= 1000 && i > 0) {
      const nextUnit = units[i - 1];
      const scaledNext = abs / nextUnit.threshold;
      const decimalsNext = scaledNext >= 100 ? 0 : 1;
      const textNext = scaledNext.toFixed(decimalsNext).replace(/\.0$/, '');
      return `${sign}${textNext}${nextUnit.suffix}`;
    }

    const text = rounded.toFixed(decimals).replace(/\.0$/, '');
    return `${sign}${text}${unit.suffix}`;
  }

  // Keep small numbers readable without overflowing UI.
  if (Number.isInteger(value)) return `${value}`;
  return `${sign}${abs.toFixed(2).replace(/\.?0+$/, '')}`;
}

export function formatExactNumber(value: number, maxFractionDigits = 20): string {
  if (!Number.isFinite(value)) return '0';

  const maximumFractionDigits = Number.isInteger(value) ? 0 : maxFractionDigits;
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
  } catch {
    return value.toFixed(maximumFractionDigits);
  }
}
