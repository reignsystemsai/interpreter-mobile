const startedAt = Date.now();
const marks = new Map<string, number>();

export function markPerformance(name: string) {
  marks.set(name, Date.now());
}

export function finishPerformance(name: string) {
  const start = marks.get(name);
  marks.delete(name);
  if (start === undefined) return null;
  const durationMs = Date.now() - start;
  if (__DEV__) console.info('[Performance]', { durationMs, metric: name });
  return durationMs;
}

export function recordAppReady() {
  const durationMs = Date.now() - startedAt;
  if (__DEV__) console.info('[Performance]', { durationMs, metric: 'app_ready' });
  return durationMs;
}
