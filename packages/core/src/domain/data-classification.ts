/**
 * The kinds of outgoing data a rule's `dataClassifications` can name, one vocabulary
 * shared by the runtime, the rule drafter and the console.
 */
export const DATA_CLASSIFICATION = {
  /** Every kind below; the word one rule uses to mean all of them. */
  SENSITIVE: 'sensitive',
  /** A credential: an API key or token, a private key, a password, a connection string. */
  SECRET: 'secret',
  /** A card, a bank account, an invoice or a payroll record. */
  FINANCIAL: 'financial',
  /** A diagnosis, a prescription, a medical record. */
  HEALTH: 'health',
  /** A national id, a social security number, a passport, a tax id. */
  GOVERNMENT_ID: 'government-id',
  /** One personal field on its own: an email, a phone number, an address. */
  PERSONAL_DATA: 'personal-data',
  /** Several personal fields about one person together, or a field under a customer key. */
  CUSTOMER_RECORD: 'customer-record',
  /** Text marked confidential, internal only or under NDA, or naming what the team listed. */
  CONFIDENTIAL: 'confidential',
  /** A program, or a file from inside the repository. */
  SOURCE_CODE: 'source-code',
  /** Many rows of anything: a table, an export, a database dump. */
  BULK_RECORDS: 'bulk-records',
} as const;

export type DataClassification =
  (typeof DATA_CLASSIFICATION)[keyof typeof DATA_CLASSIFICATION];

/** The vocabulary in one list, for a rule drafter or a screen offering the words. */
export const DATA_CLASSIFICATIONS: readonly DataClassification[] =
  Object.values(DATA_CLASSIFICATION);

/** What each word means, in the words a person choosing one would use. */
export const DATA_CLASSIFICATION_MEANING: Readonly<Record<DataClassification, string>> = {
  [DATA_CLASSIFICATION.SENSITIVE]: 'anything below',
  [DATA_CLASSIFICATION.SECRET]: 'keys, tokens, passwords and connection strings',
  [DATA_CLASSIFICATION.FINANCIAL]: 'cards, bank accounts, invoices and payroll',
  [DATA_CLASSIFICATION.HEALTH]: 'diagnoses, prescriptions and medical records',
  [DATA_CLASSIFICATION.GOVERNMENT_ID]: 'national ids, passports and tax ids',
  [DATA_CLASSIFICATION.PERSONAL_DATA]: 'one person’s email, phone or address',
  [DATA_CLASSIFICATION.CUSTOMER_RECORD]: 'several details about one customer together',
  [DATA_CLASSIFICATION.CONFIDENTIAL]:
    'material marked confidential, or naming what you listed',
  [DATA_CLASSIFICATION.SOURCE_CODE]: 'code, or a file from inside the repository',
  [DATA_CLASSIFICATION.BULK_RECORDS]: 'many rows of anything, as a table or a dump',
};

/** The need to know levels the kinds sit at; `restricted` is the ceiling. */
export const DATA_SENSITIVITY = {
  CONFIDENTIAL: 'confidential',
  RESTRICTED: 'restricted',
} as const;

export type DataSensitivity = (typeof DATA_SENSITIVITY)[keyof typeof DATA_SENSITIVITY];

export const SENSITIVITY_OF_CLASSIFICATION: Readonly<
  Record<DataClassification, DataSensitivity>
> = {
  [DATA_CLASSIFICATION.SENSITIVE]: DATA_SENSITIVITY.CONFIDENTIAL,
  [DATA_CLASSIFICATION.SECRET]: DATA_SENSITIVITY.RESTRICTED,
  [DATA_CLASSIFICATION.FINANCIAL]: DATA_SENSITIVITY.RESTRICTED,
  [DATA_CLASSIFICATION.HEALTH]: DATA_SENSITIVITY.RESTRICTED,
  [DATA_CLASSIFICATION.GOVERNMENT_ID]: DATA_SENSITIVITY.RESTRICTED,
  [DATA_CLASSIFICATION.CUSTOMER_RECORD]: DATA_SENSITIVITY.RESTRICTED,
  [DATA_CLASSIFICATION.PERSONAL_DATA]: DATA_SENSITIVITY.CONFIDENTIAL,
  [DATA_CLASSIFICATION.CONFIDENTIAL]: DATA_SENSITIVITY.CONFIDENTIAL,
  [DATA_CLASSIFICATION.SOURCE_CODE]: DATA_SENSITIVITY.CONFIDENTIAL,
  [DATA_CLASSIFICATION.BULK_RECORDS]: DATA_SENSITIVITY.CONFIDENTIAL,
};

export const SENSITIVITY_BY_NAME: ReadonlyMap<string, DataSensitivity> = new Map(
  Object.entries(SENSITIVITY_OF_CLASSIFICATION),
);

/**
 * A team's own words under a classification of its choosing, as a codename under
 * `confidential`. A pattern is a whole word matched in any case, or `/a regex/`.
 */
export interface DataPattern {
  classification: string;
  patterns: readonly string[];
}

/** A pattern longer than this is refused, since a team's regex runs on every call. */
export const MOST_PATTERN_CHARS = 200;

/** Rows of anything past which a payload is a bulk export rather than an answer. */
export const BULK_ROWS = 20;

export interface CompiledPattern {
  classification: string;
  expression: RegExp;
}
