import type { Range } from 'vscode-languageserver';
import { PROPERTY_OPTIONS } from './catalog';
import { environmentVariables, nameReferences, optionKey, typeKey, type NameReference } from './model';
import type { Command, ParsedDocument } from './parser';

export interface Occurrence {
  uri: string;
  range: Range;
  command: Command;
  reference: NameReference;
}

export interface NamedObject {
  key: string;
  objectType?: string;
  option: string;
  /** Name as first written. */
  name: string;
  definitions: Occurrence[];
  /** Every occurrence, definitions included. */
  references: Occurrence[];
}

export type Counter = Map<string, number>;

export interface Knowledge {
  subcommands: Counter;
  /** Options used with each object type, e.g. `backend` → `--backend-name`. */
  options: Map<string, Counter>;
  /** Property values seen for each object type: type → property → value counts. */
  properties: Map<string, Map<string, Counter>>;
  /** `--type` values used with each object type. */
  types: Map<string, Counter>;
  envVars: Counter;
  objects: Map<string, NamedObject>;
}

function bump(counter: Counter, key: string, by = 1): void {
  counter.set(key, (counter.get(key) ?? 0) + by);
}

function nested<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  let value = map.get(key);
  if (value === undefined) {
    value = create();
    map.set(key, value);
  }
  return value;
}

/**
 * Parsed dsconfig files across the workspace. Open documents take precedence
 * over their on-disk copies.
 */
export class WorkspaceIndex {
  private readonly open = new Map<string, ParsedDocument>();
  private readonly disk = new Map<string, ParsedDocument>();
  private cached?: Knowledge;

  setOpen(uri: string, document: ParsedDocument): void {
    this.open.set(uri, document);
    this.cached = undefined;
  }

  close(uri: string): void {
    if (this.open.delete(uri)) this.cached = undefined;
  }

  setDisk(uri: string, document: ParsedDocument): void {
    this.disk.set(uri, document);
    this.cached = undefined;
  }

  removeDisk(uri: string): void {
    if (this.disk.delete(uri)) this.cached = undefined;
  }

  clearDisk(): void {
    if (this.disk.size === 0) return;
    this.disk.clear();
    this.cached = undefined;
  }

  get(uri: string): ParsedDocument | undefined {
    return this.open.get(uri) ?? this.disk.get(uri);
  }

  *documents(): IterableIterator<[string, ParsedDocument]> {
    yield* this.open;
    for (const entry of this.disk) {
      if (!this.open.has(entry[0])) yield entry;
    }
  }

  get knowledge(): Knowledge {
    this.cached ??= this.build();
    return this.cached;
  }

  /** The named object a reference points at, resolving ambiguous options when possible. */
  resolve(reference: NameReference): NamedObject | undefined {
    const { objects } = this.knowledge;
    return objects.get(this.keyFor(reference, objects));
  }

  private keyFor(reference: NameReference, objects: Map<string, NamedObject>): string {
    if (reference.objectType) return typeKey(reference.objectType, reference.name);
    const defined = reference.candidateTypes.filter(
      (type) => (objects.get(typeKey(type, reference.name))?.definitions.length ?? 0) > 0,
    );
    if (defined.length === 1) return typeKey(defined[0], reference.name);
    return optionKey(reference.option, reference.name);
  }

  private build(): Knowledge {
    const knowledge: Knowledge = {
      subcommands: new Map(),
      options: new Map(),
      properties: new Map(),
      types: new Map(),
      envVars: new Map(),
      objects: new Map(),
    };
    const unresolved: Occurrence[] = [];

    const record = (key: string, occurrence: Occurrence, objectType?: string): void => {
      const object = nested(knowledge.objects, key, () => ({
        key,
        objectType,
        option: occurrence.reference.option,
        name: occurrence.reference.name,
        definitions: [],
        references: [],
      }));
      object.references.push(occurrence);
      if (occurrence.reference.isDefinition) object.definitions.push(occurrence);
    };

    for (const [uri, document] of this.documents()) {
      for (const command of document.commands) {
        for (const token of command.tokens) {
          for (const name of environmentVariables(token.value)) bump(knowledge.envVars, name);
        }
        if (!command.subcommand) continue;
        bump(knowledge.subcommands, command.subcommand.value.toLowerCase());

        const type = command.objectType;
        if (type) {
          const options = nested(knowledge.options, type, () => new Map());
          const properties = nested(knowledge.properties, type, () => new Map<string, Counter>());
          for (const argument of command.args) {
            if (!argument.name) continue;
            bump(options, argument.name);
            if (argument.name === '--type' && argument.value && command.verb === 'create') {
              bump(
                nested(knowledge.types, type, () => new Map()),
                argument.value.value,
              );
            }
            const assignment = argument.assignment;
            if (assignment && PROPERTY_OPTIONS.has(argument.name)) {
              const values = nested(properties, assignment.property, () => new Map());
              if (assignment.operator === ':' && assignment.value) bump(values, assignment.value);
            }
          }
        }

        for (const reference of nameReferences(command)) {
          const occurrence: Occurrence = {
            uri,
            range: document.rangeOf(reference.token),
            command,
            reference,
          };
          if (reference.objectType) {
            record(typeKey(reference.objectType, reference.name), occurrence, reference.objectType);
          } else {
            unresolved.push(occurrence);
          }
        }
      }
    }

    // Ambiguous parent options (e.g. `--provider-name`) resolve to whichever
    // candidate type actually defines an object with that name.
    for (const occurrence of unresolved) {
      const key = this.keyFor(occurrence.reference, knowledge.objects);
      const objectType = key.startsWith('type:') ? key.split(':')[1] : undefined;
      record(key, occurrence, objectType);
    }

    return knowledge;
  }
}
