export function validateString(
  value: unknown,
  fieldName: string,
  maxLen = 100
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} נדרש`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new ValidationError(`${fieldName} ארוך מדי (מקסימום ${maxLen} תווים)`);
  }
  return trimmed;
}

export function validateOptionalString(
  value: unknown,
  fieldName: string,
  maxLen = 500
): string | null {
  if (value === null || value === undefined || value === "") return null;
  return validateString(value, fieldName, maxLen);
}

export function validateInteger(
  value: unknown,
  fieldName: string
): number {
  const num = typeof value === "string" ? parseInt(value, 10) : value;
  if (typeof num !== "number" || isNaN(num) || !Number.isInteger(num)) {
    throw new ValidationError(`${fieldName} חייב להיות מספר שלם`);
  }
  return num;
}

export function validateBoolean(value: unknown): number {
  if (value === true || value === 1 || value === "true") return 1;
  if (value === false || value === 0 || value === "false" || value === undefined) return 0;
  return 0;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
