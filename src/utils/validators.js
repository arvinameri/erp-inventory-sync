import { ValidationError } from "./errors.js";

export const requiredString = (value, fieldName) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(`${fieldName} is required`);
  }

  return value.trim();
};

export const requiredNumber = (value, fieldName) => {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new ValidationError(`${fieldName} must be a valid number`);
  }

  return numberValue;
};

export const optionalBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
};

export const optionalNumber = (value, defaultValue) => {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return defaultValue;
  }

  return numberValue;
};

export const assertArray = (value, fieldName) => {
  if (!Array.isArray(value)) {
    throw new ValidationError(`${fieldName} must be an array`);
  }

  return value;
};

export const uniqueStrings = (values) => {
  return [
    ...new Set(
      values
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim()),
    ),
  ];
};
