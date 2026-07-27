/** Minimal in-process counter registry for the JSON /metrics endpoint. */
export class Counters {
  private readonly values = new Map<string, number>();

  increment(name: string, by = 1): void {
    this.values.set(name, (this.values.get(name) ?? 0) + by);
  }

  snapshot(): Record<string, number> {
    return Object.fromEntries([...this.values.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }
}
