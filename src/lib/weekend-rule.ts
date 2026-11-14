/**
 * The weekend rule (max one weekend shift per worker per year) in one place.
 * GUARD shifts never count toward it, even on a weekend date. Used by the
 * assignment warnings, ShiftHistory.was_weekend writes, and the insights views
 * and tools.
 */
export const WEEKEND_EXEMPT_SHIFT_TYPES: readonly string[] = ["GUARD"];

/** Whether a shift on this date/type counts toward the weekend rule. */
export function countsTowardWeekendRule(shiftTypeId: string, isWeekend: number | boolean): boolean {
  return !!isWeekend && !WEEKEND_EXEMPT_SHIFT_TYPES.includes(shiftTypeId);
}

/** SQL for the same check over a row aliased `alias` with shift_type_id + is_weekend: 1 or 0. */
export function weekendRuleSql(alias: string): string {
  const exempt = WEEKEND_EXEMPT_SHIFT_TYPES.map((t) => `'${t.replace(/'/g, "''")}'`).join(", ");
  return `(CASE WHEN ${alias}.shift_type_id IN (${exempt}) THEN 0 ELSE ${alias}.is_weekend END)`;
}
