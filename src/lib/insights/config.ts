/** Feature flags for the insights assistant, read from the environment. */
export const insightsEnabled = () => !!process.env.ANTHROPIC_API_KEY;
export const NOT_CONFIGURED_MESSAGE = "העוזר אינו מוגדר בשרת (חסר מפתח API)";
