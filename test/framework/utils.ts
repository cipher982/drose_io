export function generateVisitorId(prefix = 'realtime'): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${random}`;
}

export function prettyDuration(ms: number): string {
  return `${ms}ms`;
}
