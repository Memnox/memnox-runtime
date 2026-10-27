/** A payload walked once, every kind it carries noted, bounded in size and depth. */
import {
  DATA_CLASSIFICATION,
  BULK_ROWS,
  type CompiledPattern,
} from './data-classification';
import { isSecretName, secretValuesIn } from './redact';
import {
  BARE_NAME_KEY,
  FILE_KEYS,
  FINANCIAL_KEYS,
  GOVERNMENT_KEYS,
  HEALTH_KEYS,
  INVOICE_KEYS,
  INVOICE_NAMING,
  isFilled,
  isRecord,
  MARKING_KEYS,
  MARKING_VALUES,
  normalizeKey,
  PERSON_NAME,
  PERSONAL_FIELD,
  PERSONAL_KEYS,
  RECORD_KEYS,
  STRONG_FIELDS,
  type PersonalField,
} from './sensitive-keys';
import {
  BIRTH_DATE,
  CONFIDENTIAL_MARKINGS,
  hasCard,
  hasIban,
  hasPersonEmail,
  hasPhone,
  HEALTH_TERMS,
  isLiteralSecret,
  looksLikeCode,
  looksLikeDump,
  MONEY,
  MONEY_DOCUMENT,
  NINO,
  PASSPORT_IN_TEXT,
  SOURCE_FILE,
  SSN,
  STREET_ADDRESS,
  structuredIn,
  UPLOADED_FILE,
} from './sensitive-text';

/** Read this far and no further, since a body can be a whole export. */
const MOST_CHARS = 100_000;
const MOST_DEPTH = 6;

export interface ScanState {
  chars: number;
  record: boolean;
  kinds: Set<string>;
  patterns: readonly CompiledPattern[];
}

export function scanValue(
  value: unknown,
  depth: number,
  state: ScanState,
): Set<PersonalField> {
  if (typeof value === 'string') return scanString(value, depth, state);
  if (typeof value === 'number') return scanString(String(value), depth, state);
  if (depth >= MOST_DEPTH || typeof value !== 'object' || value === null)
    return new Set();
  if (Array.isArray(value)) return scanArray(value, depth, state);
  return isRecord(value) ? scanObject(value, depth, state) : new Set();
}

function scanArray(
  values: readonly unknown[],
  depth: number,
  state: ScanState,
): Set<PersonalField> {
  const rows = values.filter((each) => typeof each === 'object' && each !== null).length;
  if (rows >= BULK_ROWS) state.kinds.add(DATA_CLASSIFICATION.BULK_RECORDS);
  const fields = new Set<PersonalField>();
  for (const each of values) {
    if (state.chars >= MOST_CHARS) break;
    for (const field of scanValue(each, depth + 1, state)) fields.add(field);
  }
  return fields;
}

function scanObject(
  object: Record<string, unknown>,
  depth: number,
  state: ScanState,
): Set<PersonalField> {
  const fields = new Set<PersonalField>();
  const invoice: string[] = [];
  let underRecordKey = false;
  for (const [key, value] of Object.entries(object)) {
    if (state.chars >= MOST_CHARS) break;
    const normalized = normalizeKey(key);
    const filled = isFilled(value);
    if (filled) {
      const keyed = personalFieldOfKey(normalized, value);
      if (keyed !== undefined) fields.add(keyed);
      noteKey({ key, value }, state, invoice);
    }
    const inner = scanValue(value, depth + 1, state);
    for (const field of inner) fields.add(field);
    if (RECORD_KEYS.has(normalized) && inner.size > 0) underRecordKey = true;
  }
  if (invoice.length >= 2 && invoice.some((each) => INVOICE_NAMING.has(each))) {
    state.kinds.add(DATA_CLASSIFICATION.FINANCIAL);
  }
  if (underRecordKey || fields.size >= 2) state.record = true;
  return fields;
}

/** What a field's name alone says, where it holds something. */
function noteKey(
  { key, value }: { key: string; value: unknown },
  state: ScanState,
  invoice: string[],
): void {
  const normalized = normalizeKey(key);
  if (GOVERNMENT_KEYS.has(normalized)) state.kinds.add(DATA_CLASSIFICATION.GOVERNMENT_ID);
  if (FINANCIAL_KEYS.has(normalized)) state.kinds.add(DATA_CLASSIFICATION.FINANCIAL);
  if (INVOICE_KEYS.has(normalized)) invoice.push(normalized);
  if (HEALTH_KEYS.has(normalized)) state.kinds.add(DATA_CLASSIFICATION.HEALTH);
  if (typeof value !== 'string') return;
  if (isSecretName(key) && isLiteralSecret(value)) {
    state.kinds.add(DATA_CLASSIFICATION.SECRET);
  }
  if (MARKING_KEYS.has(normalized) && MARKING_VALUES.test(value.trim())) {
    state.kinds.add(DATA_CLASSIFICATION.CONFIDENTIAL);
  }
  if (FILE_KEYS.has(normalized) && SOURCE_FILE.test(value.trim())) {
    state.kinds.add(DATA_CLASSIFICATION.SOURCE_CODE);
  }
}

function personalFieldOfKey(key: string, value: unknown): PersonalField | undefined {
  if (key === BARE_NAME_KEY) {
    return typeof value === 'string' && PERSON_NAME.test(value.trim())
      ? PERSONAL_FIELD.NAME
      : undefined;
  }
  if (GOVERNMENT_KEYS.has(key)) return PERSONAL_FIELD.NATIONAL_ID;
  return PERSONAL_KEYS[key];
}

function scanString(text: string, depth: number, state: ScanState): Set<PersonalField> {
  const room = MOST_CHARS - state.chars;
  if (room <= 0) return new Set();
  const bounded = text.length > room ? text.slice(0, room) : text;
  state.chars += bounded.length;
  const trimmed = bounded.trim();
  const structured = structuredIn(trimmed);
  if (structured !== null && depth < MOST_DEPTH) {
    state.chars -= bounded.length;
    return scanValue(structured, depth + 1, state);
  }
  noteText(bounded, state);
  const table = tableHeaderFields(trimmed, state);
  if (table !== null) return table;
  const fields = personalFieldsInText(bounded, state);
  const strong = [...fields].some((field) => STRONG_FIELDS.has(field));
  if ((strong && fields.size >= 2) || fields.size >= 3) state.record = true;
  return fields;
}

/** Everything text says on its own: credentials, markings, money, health, code and dumps. */
function noteText(text: string, state: ScanState): void {
  if (secretValuesIn(text).some(isLiteralSecret)) {
    state.kinds.add(DATA_CLASSIFICATION.SECRET);
  }
  if (CONFIDENTIAL_MARKINGS.some((marking) => marking.test(text))) {
    state.kinds.add(DATA_CLASSIFICATION.CONFIDENTIAL);
  }
  for (const pattern of state.patterns) {
    if (pattern.expression.test(text)) state.kinds.add(pattern.classification);
  }
  if (MONEY_DOCUMENT.test(text) && MONEY.test(text)) {
    state.kinds.add(DATA_CLASSIFICATION.FINANCIAL);
  }
  if (HEALTH_TERMS.filter((term) => term.test(text)).length >= 2) {
    state.kinds.add(DATA_CLASSIFICATION.HEALTH);
  }
  // `@src/app.ts` or `file=@src/app.ts`, a file curl reads and sends whole.
  const upload = UPLOADED_FILE.exec(text.trim())?.[1];
  if (upload !== undefined && SOURCE_FILE.test(upload)) {
    state.kinds.add(DATA_CLASSIFICATION.SOURCE_CODE);
  }
  if (text.includes('\n')) {
    if (looksLikeCode(text)) state.kinds.add(DATA_CLASSIFICATION.SOURCE_CODE);
    if (looksLikeDump(text)) state.kinds.add(DATA_CLASSIFICATION.BULK_RECORDS);
  }
}

/**
 * A CSV or TSV: many rows make it bulk, and a header naming two personal columns makes
 * it customer records. Null where the text is not a table of people.
 */
function tableHeaderFields(text: string, state: ScanState): Set<PersonalField> | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const header = lines[0];
  if (header === undefined || lines.length < 2) return null;
  const delimiter = [',', '\t', ';'].find((each) => header.includes(each));
  if (delimiter === undefined) return null;
  const columns = header.split(delimiter).length;
  const rows = lines.slice(1).filter((line) => line.split(delimiter).length === columns);
  if (rows.length >= BULK_ROWS) state.kinds.add(DATA_CLASSIFICATION.BULK_RECORDS);
  const fields = new Set<PersonalField>();
  for (const cell of header.split(delimiter)) {
    const key = normalizeKey(cell.replace(/^["']|["']$/g, ''));
    const field = GOVERNMENT_KEYS.has(key)
      ? PERSONAL_FIELD.NATIONAL_ID
      : PERSONAL_KEYS[key];
    if (field !== undefined) fields.add(field);
    noteKey({ key, value: undefined }, state, []);
  }
  if (fields.size < 2 || rows.length === 0) return null;
  state.record = true;
  return fields;
}

function personalFieldsInText(text: string, state: ScanState): Set<PersonalField> {
  const fields = new Set<PersonalField>();
  if (hasPersonEmail(text)) fields.add(PERSONAL_FIELD.EMAIL);
  if (hasPhone(text)) fields.add(PERSONAL_FIELD.PHONE);
  if (hasCard(text)) {
    fields.add(PERSONAL_FIELD.CARD);
    state.kinds.add(DATA_CLASSIFICATION.FINANCIAL);
  }
  if (hasIban(text)) {
    fields.add(PERSONAL_FIELD.IBAN);
    state.kinds.add(DATA_CLASSIFICATION.FINANCIAL);
  }
  if (SSN.test(text) || NINO.test(text) || PASSPORT_IN_TEXT.test(text)) {
    fields.add(PERSONAL_FIELD.NATIONAL_ID);
    state.kinds.add(DATA_CLASSIFICATION.GOVERNMENT_ID);
  }
  if (BIRTH_DATE.test(text)) fields.add(PERSONAL_FIELD.BIRTH_DATE);
  if (STREET_ADDRESS.test(text)) fields.add(PERSONAL_FIELD.ADDRESS);
  return fields;
}
