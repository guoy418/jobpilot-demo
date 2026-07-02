export const shouldUseParsedDraftValue = (currentValue: string, defaultValues: string[] = []) => {
  const current = currentValue.trim();
  return !current || defaultValues.includes(current);
};

export const mergeParsedDraftValue = (currentValue: string, parsedValue: string | undefined, defaultValues: string[] = []) => {
  const parsed = parsedValue?.trim();
  if (!parsed) return currentValue;
  return shouldUseParsedDraftValue(currentValue, defaultValues) ? parsed : currentValue;
};
