import { isNamingOption, namingSpec, typesForNamingOption } from './catalog';
import type { Argument, Command, Token } from './parser';

/** A naming argument value, e.g. `userRoot` in `--backend-name userRoot`. */
export interface NameReference {
  option: string;
  name: string;
  token: Token;
  argument: Argument;
  /** The object type the name refers to, when it can be determined. */
  objectType?: string;
  /** Possible object types when the option is shared by several types (`--provider-name`). */
  candidateTypes: readonly string[];
  /** True when the argument names the command's own object rather than a parent. */
  isSelf: boolean;
  /** True for the self name of a `create-*` command. */
  isDefinition: boolean;
}

export function namingArguments(command: Command): Argument[] {
  return command.args.filter((argument) => argument.name && argument.value && isNamingOption(argument.name));
}

/** The naming argument that identifies the command's own object, if any. */
export function selfNamingArgument(
  command: Command,
  naming = namingArguments(command),
): Argument | undefined {
  const type = command.objectType;
  if (!type || command.verb === 'list') return undefined;
  const spec = namingSpec(type);
  if (spec.self) {
    const match = naming.find((argument) => argument.name === spec.self);
    if (match) return match;
  }
  if (spec.exact) return undefined;
  // The naming convention guess didn't match, so fall back to the last
  // non-parent naming argument, which is how dsconfig orders them.
  const candidates = naming.filter((argument) => !spec.parents.includes(argument.name!));
  return candidates.find((argument) => argument.name === '--name') ?? candidates[candidates.length - 1];
}

export function nameReferences(command: Command): NameReference[] {
  const naming = namingArguments(command);
  if (naming.length === 0) return [];
  const self = selfNamingArgument(command, naming);
  return naming.map((argument) => {
    const isSelf = argument === self;
    const candidateTypes =
      isSelf && command.objectType ? [command.objectType] : typesForNamingOption(argument.name!);
    return {
      option: argument.name!,
      name: argument.value!.value,
      token: argument.value!,
      argument,
      objectType: candidateTypes.length === 1 ? candidateTypes[0] : undefined,
      candidateTypes,
      isSelf,
      isDefinition: isSelf && command.verb === 'create',
    };
  });
}

export function referenceAt(command: Command, offset: number): NameReference | undefined {
  return nameReferences(command).find(
    (reference) => offset >= reference.token.start && offset <= reference.token.end,
  );
}

export function typeKey(objectType: string, name: string): string {
  return `type:${objectType}:${name.toLowerCase()}`;
}

export function optionKey(option: string, name: string): string {
  return `option:${option}:${name.toLowerCase()}`;
}

/** Display label for a command, e.g. `create-backend userRoot`. */
export function commandLabel(command: Command): string {
  const subcommand = command.subcommand?.value ?? command.tokens[0]?.value ?? '';
  const names = namingArguments(command).map((argument) => argument.value!.value);
  return names.length > 0 ? `${subcommand} ${names.join(' / ')}` : subcommand;
}

const ENV_VAR = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function environmentVariables(text: string): string[] {
  return [...text.matchAll(ENV_VAR)].map((match) => match[1]);
}
