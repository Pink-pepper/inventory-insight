/**
 * Minimal ambient typings for the Bun test runner used by fixture tests.
 * Runtime behaviour comes from `bun test`; this only satisfies the compiler.
 */
declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toContain(expected: unknown): void;
    toBeNull(): void;
    toHaveLength(expected: number): void;
    toBeGreaterThan(expected: number): void;
    not: { toContain(expected: unknown): void };
  };
}
