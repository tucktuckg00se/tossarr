/** True when the title already ends with "(year)", e.g. "The Paper (2025)". */
export function titleEndsWithYear(title: string, year: number | null): boolean {
  if (year === null) return false;
  const normalized = title.replace(/\s+/g, ' ').trim();
  return normalized.endsWith(`(${year})`) || normalized.endsWith(`( ${year} )`);
}

/** Title with the year appended only when it isn't already part of the title. */
export function displayTitle(title: string, year: number | null): string {
  if (year === null || titleEndsWithYear(title, year)) return title;
  return `${title} (${year})`;
}
