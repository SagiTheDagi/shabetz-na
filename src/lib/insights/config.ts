/** Feature flags for the insights assistant, read from the environment. */
export const insightsEnabled = () => !!process.env.ANTHROPIC_API_KEY;
export const pseudonymizeEnabled = () => process.env.INSIGHTS_PSEUDONYMIZE === "true";
/** HMAC secret for aliases: own one when set, so rotating the session key doesn't change them. Server-only. */
export const aliasSecret = () => process.env.INSIGHTS_ALIAS_SECRET || process.env.SESSION_SECRET || "";
/** Pseudonymization is on but has no secret: the assistant refuses to run rather than send real names. */
export const pseudonymizeMisconfigured = () => pseudonymizeEnabled() && !aliasSecret();
export const ALIAS_SECRET_MISSING_MESSAGE = "העוזר אינו זמין: INSIGHTS_PSEUDONYMIZE פעיל אך חסר INSIGHTS_ALIAS_SECRET או SESSION_SECRET";
export const NOT_CONFIGURED_MESSAGE = "העוזר אינו מוגדר בשרת (חסר מפתח API)";
/** Rows a rendered chart/table carries to the client (rest dropped, spec.truncated set). Client-safe. */
export const MAX_RENDER_ROWS = 500;
/**
 * Max days a new heatmap_calendar may span (53 weeks). Below MAX_RENDER_ROWS, so
 * one row per day always fits; the client clips saved re-runs to the same. Client-safe.
 */
export const MAX_HEATMAP_DAYS = 371;
/** Categorical chart colors (insight-chart.tsx). Client-safe. */
export const CHART_PALETTE = ["#9184d9", "#56b4e9", "#e69f00", "#2fb58f", "#cc79a7", "#e07a5f", "#d8c95a", "#8a96ab"] as const;
/** Max series per chart: one palette color each, so colors never repeat. Client-safe. */
export const MAX_CHART_SERIES = CHART_PALETTE.length;
/**
 * Pseudonymization aliases ("W-3fa91c2d"); see pseudonymize.ts. Whole token
 * only: not inside "ROW-abc1", and not when more letters/digits follow (a
 * longer hex run is not a shorter alias). "_" may follow ("W-abc_count").
 * A hyphen may precede it only after a Hebrew letter: a prefix joined with a
 * hyphen ("ל-W-abc") is common Hebrew; "x-W-abc" is not an alias. Client-safe.
 */
export const ALIAS_RE = /(?<!\w)(?<!(?<!\p{Script=Hebrew})-)W-[0-9a-f]{3,64}(?![0-9A-Za-z])/gu;
