export type FillField = {
  key: string;
  label: string;
  value: string;
  max: number;
  hint?: string;
};

/*
 * Find the first complete JSON object in a model answer. Small models often wrap JSON
 * in prose or code fences; a brace-depth scan keeps a brace inside a string from ending
 * the object early. If the first brace belongs to prose rather than JSON, try the next one.
 */
function matchingBraceEnd(source: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const source = String(text || "");
  let start = source.indexOf("{");
  while (start >= 0) {
    const end = matchingBraceEnd(source, start);
    if (end > start) {
      try {
        const parsed = JSON.parse(source.slice(start, end + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Try the next opening brace; the first one may be prose.
      }
    }
    start = source.indexOf("{", start + 1);
  }
  return null;
}

export function fillValuesFromJson(
  parsed: Record<string, unknown>,
  missing: FillField[],
): Record<string, string> {
  const byKey = new Map(
    Object.entries(parsed).map(([key, value]) => [key.trim().toLowerCase(), value]),
  );
  const values: Record<string, string> = {};
  for (const field of missing) {
    const raw = parsed[field.key] ?? byKey.get(field.key.toLowerCase());
    if (typeof raw !== "string" && !(typeof raw === "number" && Number.isFinite(raw))) continue;
    const trimmed = String(raw).trim();
    if (!trimmed || /^(?:string|<string>)$/i.test(trimmed)) continue;
    const value = trimmed.slice(0, field.max);
    if (value) values[field.key] = value;
  }
  return values;
}
