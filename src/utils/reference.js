function bangkokDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}`;
}

export function createReferenceNumber(sequenceValue, now = new Date()) {
  const sequence = String(sequenceValue).padStart(6, '0');
  return `CMP-${bangkokDateParts(now)}-${sequence}`;
}
