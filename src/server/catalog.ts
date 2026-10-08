import { PINGDIRECTORY_SUBCOMMANDS } from './subcommands';

export type Verb = 'create' | 'delete' | 'get' | 'set' | 'list';

export interface SubcommandInfo {
  name: string;
  /** Undefined for custom subcommands that do not follow the verb-type naming pattern. */
  verb?: Verb;
  /** Configuration object type, e.g. `local-db-index`. Undefined for `list-properties`. */
  objectType?: string;
  description: string;
  /** False for subcommands supplied through `dsconfig.additionalSubcommands`. */
  builtin: boolean;
}

export interface OptionInfo {
  name: string;
  aliases?: string[];
  takesValue: boolean;
  valueHint?: string;
  description: string;
  values?: string[];
  repeatable?: boolean;
}

const ACRONYMS: Record<string, string> = {
  db: 'DB',
  dn: 'DN',
  dse: 'DSE',
  http: 'HTTP',
  id: 'ID',
  json: 'JSON',
  ldap: 'LDAP',
  ldif: 'LDIF',
  mac: 'MAC',
  oauth: 'OAuth',
  otp: 'OTP',
  rest: 'REST',
  sasl: 'SASL',
  scim: 'SCIM',
  sdk: 'SDK',
  vlv: 'VLV',
};

// Plural forms that can't be derived by adding -s/-es/-ies.
const LIST_TYPE_OVERRIDES: Record<string, string> = {
  'list-entry-counter-criteria': 'entry-counter-plugin-criteria',
};

// Naming arguments that don't follow the `--<last-word>-name` convention, or
// that also need a parent object's name. `self: null` means the object has no
// name of its own (a singleton beneath a named parent).
const NAMING_OVERRIDES: Record<string, { parents?: string[]; self: string | null }> = {
  'virtual-attribute': { self: '--name' },
  'local-db-index': { parents: ['--backend-name'], self: '--index-name' },
  'local-db-vlv-index': { parents: ['--backend-name'], self: '--index-name' },
  'local-db-composite-index': { parents: ['--backend-name'], self: '--index-name' },
  'replication-domain': { parents: ['--provider-name'], self: '--domain-name' },
  'replication-server': { parents: ['--provider-name'], self: null },
};

export const PROPERTY_OPTIONS = new Set(['--set', '--add', '--remove', '--reset', '--property']);
export const ASSIGNMENT_OPTIONS = new Set(['--set', '--add', '--remove']);

const VERB_OPTIONS: Record<Verb, OptionInfo[]> = {
  create: [
    {
      name: '--type',
      aliases: ['-t'],
      takesValue: true,
      valueHint: '{type}',
      description: 'The type of object to create.',
    },
    {
      name: '--set',
      takesValue: true,
      valueHint: '{PROP:VALUE}',
      repeatable: true,
      description:
        'Assigns a value to a property. Repeat the option to assign several values to a multi-valued property. Use `PROP<FILE` to read the value from a file.',
    },
  ],
  set: [
    {
      name: '--set',
      takesValue: true,
      valueHint: '{PROP:VALUE}',
      repeatable: true,
      description:
        'Assigns a value to a property, replacing any existing values. Repeat the option to assign several values to a multi-valued property. Use `PROP<FILE` to read the value from a file.',
    },
    {
      name: '--add',
      takesValue: true,
      valueHint: '{PROP:VALUE}',
      repeatable: true,
      description: 'Adds a value to a multi-valued property.',
    },
    {
      name: '--remove',
      takesValue: true,
      valueHint: '{PROP:VALUE}',
      repeatable: true,
      description: 'Removes a value from a multi-valued property.',
    },
    {
      name: '--reset',
      takesValue: true,
      valueHint: '{PROP}',
      repeatable: true,
      description: 'Resets a property to its default value.',
    },
  ],
  get: [
    {
      name: '--property',
      takesValue: true,
      valueHint: '{PROP}',
      repeatable: true,
      description: 'The name of a property to display. Repeat the option to display several properties.',
    },
    {
      name: '--record',
      takesValue: false,
      description: 'Display one property value per line.',
    },
    {
      name: '--unit-size',
      takesValue: true,
      valueHint: '{unit}',
      description: 'Display size values using the specified unit.',
    },
    {
      name: '--unit-time',
      takesValue: true,
      valueHint: '{unit}',
      description: 'Display duration values using the specified unit.',
    },
  ],
  list: [],
  delete: [
    {
      name: '--force',
      aliases: ['-f'],
      takesValue: false,
      description: 'Ignore objects that do not exist.',
    },
  ],
};
VERB_OPTIONS.list = VERB_OPTIONS.get;

export const GLOBAL_OPTIONS: OptionInfo[] = [
  {
    name: '--hostname',
    aliases: ['-h'],
    takesValue: true,
    valueHint: '{host}',
    description: 'Directory server hostname or IP address.',
  },
  {
    name: '--port',
    aliases: ['-p'],
    takesValue: true,
    valueHint: '{port}',
    description: 'Directory server port number.',
  },
  {
    name: '--bindDN',
    aliases: ['-D'],
    takesValue: true,
    valueHint: '{bindDN}',
    description: 'DN used to bind to the server.',
  },
  {
    name: '--bindPassword',
    aliases: ['-w'],
    takesValue: true,
    valueHint: '{bindPassword}',
    description: 'Password used to bind to the server.',
  },
  {
    name: '--bindPasswordFile',
    aliases: ['-j'],
    takesValue: true,
    valueHint: '{path}',
    description: 'File containing the bind password.',
  },
  {
    name: '--useSSL',
    aliases: ['-Z'],
    takesValue: false,
    description: 'Use SSL to secure communication with the server.',
  },
  {
    name: '--useStartTLS',
    aliases: ['-q'],
    takesValue: false,
    description: 'Use StartTLS to secure communication with the server.',
  },
  {
    name: '--useNoSecurity',
    takesValue: false,
    description: 'Communicate with the server without SSL or StartTLS.',
  },
  {
    name: '--trustAll',
    aliases: ['-X'],
    takesValue: false,
    description: 'Trust any certificate presented by the server.',
  },
  {
    name: '--trustStorePath',
    aliases: ['-P'],
    takesValue: true,
    valueHint: '{path}',
    description: 'Trust store used to validate the server certificate.',
  },
  {
    name: '--trustStorePassword',
    aliases: ['-T'],
    takesValue: true,
    valueHint: '{password}',
    description: 'Trust store PIN.',
  },
  {
    name: '--trustStorePasswordFile',
    aliases: ['-U'],
    takesValue: true,
    valueHint: '{path}',
    description: 'File containing the trust store PIN.',
  },
  {
    name: '--keyStorePath',
    aliases: ['-K'],
    takesValue: true,
    valueHint: '{path}',
    description: 'Key store containing the client certificate.',
  },
  {
    name: '--keyStorePassword',
    aliases: ['-W'],
    takesValue: true,
    valueHint: '{password}',
    description: 'Key store PIN.',
  },
  {
    name: '--keyStorePasswordFile',
    aliases: ['-u'],
    takesValue: true,
    valueHint: '{path}',
    description: 'File containing the key store PIN.',
  },
  {
    name: '--certNickname',
    aliases: ['-N'],
    takesValue: true,
    valueHint: '{nickname}',
    description: 'Nickname of the client certificate.',
  },
  {
    name: '--saslOption',
    aliases: ['-o'],
    takesValue: true,
    valueHint: '{name=value}',
    repeatable: true,
    description: 'SASL bind option.',
  },
  {
    name: '--propertiesFilePath',
    takesValue: true,
    valueHint: '{path}',
    description: 'Properties file with default argument values.',
  },
  {
    name: '--noPropertiesFile',
    takesValue: false,
    description: 'Do not read default argument values from a properties file.',
  },
  {
    name: '--no-prompt',
    aliases: ['-n'],
    takesValue: false,
    description: 'Run non-interactively and fail instead of prompting.',
  },
  {
    name: '--offline',
    takesValue: false,
    description: 'Operate directly on the configuration files while the server is stopped.',
  },
  {
    name: '--advanced',
    takesValue: false,
    description: 'Allow configuration of advanced components and properties.',
  },
  {
    name: '--batch-file',
    aliases: ['-F'],
    takesValue: true,
    valueHint: '{path}',
    description: 'Read dsconfig subcommands from a batch file.',
  },
  {
    name: '--batch-continue-on-error',
    takesValue: false,
    description: 'Keep processing a batch file after a subcommand fails.',
  },
  {
    name: '--applyChangeTo',
    takesValue: true,
    valueHint: '{single-server|server-group}',
    values: ['single-server', 'server-group'],
    description: 'Apply the change to this server only, or to every server in its server group.',
  },
  {
    name: '--script-friendly',
    aliases: ['-s'],
    takesValue: false,
    description: 'Produce output that is easy to parse in scripts.',
  },
  { name: '--quiet', aliases: ['-Q'], takesValue: false, description: 'Suppress informational output.' },
  {
    name: '--displayCommand',
    takesValue: false,
    description: 'Print the equivalent non-interactive command.',
  },
  { name: '--help', aliases: ['-H'], takesValue: false, description: 'Display usage information.' },
];

const GLOBAL_OPTION_MAP = new Map<string, OptionInfo>();
for (const option of GLOBAL_OPTIONS) {
  GLOBAL_OPTION_MAP.set(option.name, option);
  for (const alias of option.aliases ?? []) {
    GLOBAL_OPTION_MAP.set(alias, option);
  }
}

const OBJECT_TYPES = new Set<string>();
const LIST_TYPES = new Map<string, string>();
const CREATABLE_TYPES = new Set<string>();

for (const name of PINGDIRECTORY_SUBCOMMANDS) {
  let match: RegExpMatchArray | null;
  if ((match = name.match(/^(create|delete)-(.+)$/))) {
    OBJECT_TYPES.add(match[2]);
    if (match[1] === 'create') CREATABLE_TYPES.add(match[2]);
  } else if ((match = name.match(/^(get|set)-(.+)-prop$/))) {
    OBJECT_TYPES.add(match[2]);
  }
}

function pluralForms(type: string): string[] {
  const forms = [`${type}s`, `${type}es`, type];
  if (type.endsWith('y')) forms.push(`${type.slice(0, -1)}ies`);
  return forms;
}

for (const name of PINGDIRECTORY_SUBCOMMANDS) {
  if (!name.startsWith('list-') || name === 'list-properties') continue;
  const override = LIST_TYPE_OVERRIDES[name];
  if (override) {
    LIST_TYPES.set(name, override);
    continue;
  }
  const plural = name.slice('list-'.length);
  for (const type of OBJECT_TYPES) {
    if (pluralForms(type).includes(plural)) {
      LIST_TYPES.set(name, type);
      break;
    }
  }
}

const LISTABLE_TYPES = new Set(LIST_TYPES.values());

export const BUILTIN_SUBCOMMANDS: ReadonlySet<string> = new Set(PINGDIRECTORY_SUBCOMMANDS);

export function objectTypeLabel(type: string): string {
  return type
    .split('-')
    .map((word) => ACRONYMS[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function singularize(plural: string): string {
  if (plural.endsWith('ies')) return `${plural.slice(0, -3)}y`;
  if (/(?:x|ss|sh|ch)es$/.test(plural)) return plural.slice(0, -2);
  if (plural.endsWith('s') && !plural.endsWith('ss')) return plural.slice(0, -1);
  return plural;
}

function describe(verb: Verb, objectType: string | undefined): string {
  if (!objectType) return 'Lists the properties of configuration objects.';
  const label = objectTypeLabel(objectType);
  switch (verb) {
    case 'create':
      return `Creates a ${label}.`;
    case 'delete':
      return `Deletes a ${label}.`;
    case 'get':
      return `Shows ${label} properties.`;
    case 'set':
      return `Modifies ${label} properties.`;
    case 'list':
      return `Lists the ${label} objects.`;
  }
}

/** Splits a subcommand name into verb and object type without checking it exists. */
export function parseSubcommandName(name: string): { verb: Verb; objectType?: string } | undefined {
  const lower = name.toLowerCase();
  if (lower === 'list-properties') return { verb: 'list' };
  let match: RegExpMatchArray | null;
  if ((match = lower.match(/^(create|delete)-([a-z][a-z0-9-]*)$/))) {
    return { verb: match[1] as Verb, objectType: match[2] };
  }
  if ((match = lower.match(/^(get|set)-([a-z][a-z0-9-]*)-prop$/))) {
    return { verb: match[1] as Verb, objectType: match[2] };
  }
  if ((match = lower.match(/^list-([a-z][a-z0-9-]*)$/))) {
    return { verb: 'list', objectType: LIST_TYPES.get(lower) ?? singularize(match[1]) };
  }
  return undefined;
}

export class Catalog {
  private readonly known: Set<string>;
  private related?: Map<string, string[]>;

  constructor(additionalSubcommands: readonly string[] = []) {
    this.known = new Set([
      ...BUILTIN_SUBCOMMANDS,
      ...additionalSubcommands.map((name) => name.toLowerCase()),
    ]);
  }

  get subcommands(): Iterable<string> {
    return this.known;
  }

  isKnown(name: string): boolean {
    return this.known.has(name.toLowerCase());
  }

  lookup(name: string): SubcommandInfo | undefined {
    const lower = name.toLowerCase();
    if (!this.known.has(lower)) return undefined;
    const parsed = parseSubcommandName(lower);
    if (!parsed) {
      return { name: lower, description: 'Custom subcommand.', builtin: false };
    }
    return {
      name: lower,
      verb: parsed.verb,
      objectType: parsed.objectType,
      description: describe(parsed.verb, parsed.objectType),
      builtin: BUILTIN_SUBCOMMANDS.has(lower),
    };
  }

  /** Close matches for a misspelled subcommand, best first. */
  suggest(name: string, limit = 3): string[] {
    const lower = name.toLowerCase();
    const scored: { name: string; score: number }[] = [];
    const exactFixes = new Set<string>();

    // Common structural slips: `set-backend` → `set-backend-prop`, `list-backend` → `list-backends`.
    const missingProp = lower.match(/^(get|set)-(.+?)(?:-props?)?$/);
    if (missingProp) exactFixes.add(`${missingProp[1]}-${missingProp[2]}-prop`);
    const listMatch = lower.match(/^list-(.+)$/);
    if (listMatch) {
      for (const form of pluralForms(listMatch[1])) exactFixes.add(`list-${form}`);
    }

    for (const candidate of this.known) {
      if (candidate === lower) continue;
      if (exactFixes.has(candidate)) {
        scored.push({ name: candidate, score: 0 });
        continue;
      }
      const max = lower.length <= 10 ? 2 : 3;
      if (Math.abs(candidate.length - lower.length) > max) continue;
      const distance = editDistance(lower, candidate, max);
      if (distance <= max) scored.push({ name: candidate, score: distance });
    }
    scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    return scored.slice(0, limit).map((entry) => entry.name);
  }

  /** Subcommands for an object type, in lifecycle order. */
  relatedSubcommands(objectType: string): readonly string[] {
    if (!this.related) {
      this.related = new Map();
      const order: Verb[] = ['create', 'get', 'set', 'list', 'delete'];
      const parsed = [...this.known]
        .map((name) => ({ name, ...parseSubcommandName(name) }))
        .filter((entry) => entry.objectType && entry.verb)
        .sort((a, b) => order.indexOf(a.verb!) - order.indexOf(b.verb!));
      for (const entry of parsed) {
        const names = this.related.get(entry.objectType!) ?? [];
        names.push(entry.name);
        this.related.set(entry.objectType!, names);
      }
    }
    return this.related.get(objectType) ?? [];
  }
}

export function isSingletonType(type: string): boolean {
  return (
    OBJECT_TYPES.has(type) &&
    !CREATABLE_TYPES.has(type) &&
    !LISTABLE_TYPES.has(type) &&
    !NAMING_OVERRIDES[type]
  );
}

export function isNamingOption(option: string): boolean {
  return /^--(?:[a-z0-9-]+-)?name$/i.test(option);
}

export interface NamingSpec {
  /** Naming arguments that identify parent objects, e.g. `--backend-name` for an index. */
  parents: string[];
  /** Naming argument that identifies the object itself. */
  self?: string;
  /** False when `self` is only a guess from the `--<last-word>-name` convention. */
  exact: boolean;
}

export function namingSpec(type: string): NamingSpec {
  const override = NAMING_OVERRIDES[type];
  if (override) return { parents: override.parents ?? [], self: override.self ?? undefined, exact: true };
  if (isSingletonType(type)) return { parents: [], exact: true };
  return { parents: [], self: `--${type.split('-').pop()}-name`, exact: false };
}

/** The naming arguments a subcommand for this object type is expected to take. */
export function namingOptionsForType(type: string): string[] {
  const spec = namingSpec(type);
  return spec.self ? [...spec.parents, spec.self] : spec.parents;
}

const TYPES_BY_PRIMARY_OPTION = new Map<string, string[]>();
for (const type of OBJECT_TYPES) {
  const option = namingSpec(type).self;
  if (!option) continue;
  const types = TYPES_BY_PRIMARY_OPTION.get(option) ?? [];
  types.push(type);
  TYPES_BY_PRIMARY_OPTION.set(option, types);
}

/** Object types whose own naming argument is `option`, e.g. `--backend-name` → `backend`. */
export function typesForNamingOption(option: string): readonly string[] {
  return TYPES_BY_PRIMARY_OPTION.get(option.toLowerCase()) ?? [];
}

export function verbOptions(verb: Verb): readonly OptionInfo[] {
  return VERB_OPTIONS[verb];
}

/** Options that only make sense for some verbs. */
const VERB_SPECIFIC_OPTIONS = new Set(
  Object.values(VERB_OPTIONS).flatMap((options) => options.map((option) => option.name)),
);

/** False for verb-specific options used with the wrong verb, e.g. `--add` on `create-*`. */
export function optionAppliesToVerb(name: string, verb: Verb): boolean {
  return !VERB_SPECIFIC_OPTIONS.has(name) || VERB_OPTIONS[verb].some((option) => option.name === name);
}

/** Resolves an option or alias to its definition, preferring verb-specific options. */
export function findOption(name: string, verb?: Verb): OptionInfo | undefined {
  const verbs: Verb[] = verb ? [verb] : ['create', 'set', 'get', 'delete'];
  for (const candidateVerb of verbs) {
    const option = VERB_OPTIONS[candidateVerb].find(
      (entry) => entry.name === name || entry.aliases?.includes(name),
    );
    if (option) return option;
  }
  return GLOBAL_OPTION_MAP.get(name);
}

/** Canonical long form of an option, resolving short aliases like `-t`. */
export function canonicalOptionName(name: string, verb?: Verb): string {
  if (name.startsWith('--')) return name;
  return findOption(name, verb)?.name ?? name;
}

/** Whether an option consumes the following token. Unknown options are assumed to. */
export function optionTakesValue(name: string, verb?: Verb): boolean {
  return findOption(name, verb)?.takesValue ?? true;
}

/** Optimal string alignment distance, abandoning early once `max` is exceeded. */
export function editDistance(a: string, b: string, max = Infinity): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return rowMin;
  }
  return d[rows - 1][cols - 1];
}
