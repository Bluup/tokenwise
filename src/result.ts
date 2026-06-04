/**
 * Minimal Result type — business logic returns Result instead of throwing,
 * per the ventures-lab conventions.
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const Result = {
  ok<T>(value: T): Result<T> {
    return { ok: true, value };
  },
  fail<T = never>(error: string): Result<T> {
    return { ok: false, error };
  },
};
