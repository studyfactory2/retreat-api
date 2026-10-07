export function trimPublicContactPhone({ value }: { value: unknown }): unknown {
  // Only ordinary outer spaces are formatting; controls must stay invalid.
  return typeof value === 'string'
    ? value.replace(/^ +| +$/g, '') || null
    : value;
}

export function isPublicContactPhone(value: unknown): boolean {
  if (
    typeof value !== 'string' ||
    value.length > 32 ||
    !/^\+?[0-9]+(?:[ -][0-9]+)*(?![\s\S])/u.test(value)
  ) {
    return false;
  }
  const digitCount = value.replace(/[^0-9]/g, '').length;
  return digitCount >= 7 && digitCount <= 15;
}
