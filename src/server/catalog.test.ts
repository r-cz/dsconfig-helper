import { describe, expect, it } from 'bun:test';
import {
  Catalog,
  editDistance,
  isSingletonType,
  namingSpec,
  objectTypeLabel,
  parseSubcommandName,
  typesForNamingOption,
} from './catalog';

describe('parseSubcommandName', () => {
  it('splits each verb form into verb and object type', () => {
    expect(parseSubcommandName('create-local-db-index')).toEqual({
      verb: 'create',
      objectType: 'local-db-index',
    });
    expect(parseSubcommandName('set-backend-prop')).toEqual({ verb: 'set', objectType: 'backend' });
    expect(parseSubcommandName('list-password-policies')).toEqual({
      verb: 'list',
      objectType: 'password-policy',
    });
    expect(parseSubcommandName('list-local-db-indexes')).toEqual({
      verb: 'list',
      objectType: 'local-db-index',
    });
    expect(parseSubcommandName('list-entry-counter-criteria')).toEqual({
      verb: 'list',
      objectType: 'entry-counter-plugin-criteria',
    });
    expect(parseSubcommandName('list-properties')).toEqual({ verb: 'list' });
    expect(parseSubcommandName('set-backend')).toBeUndefined();
  });
});

describe('Catalog', () => {
  const catalog = new Catalog(['set-policy-decision-service-prop']);

  it('knows built-in and additional subcommands', () => {
    expect(catalog.isKnown('create-backend')).toBe(true);
    expect(catalog.isKnown('CREATE-BACKEND')).toBe(true);
    expect(catalog.isKnown('set-policy-decision-service-prop')).toBe(true);
    expect(catalog.lookup('set-policy-decision-service-prop')).toMatchObject({ verb: 'set', builtin: false });
    expect(catalog.lookup('create-backend')).toMatchObject({
      description: 'Creates a Backend.',
      builtin: true,
    });
  });

  it('suggests corrections for typos and structural slips', () => {
    expect(catalog.suggest('crate-backend')[0]).toBe('create-backend');
    expect(catalog.suggest('set-backend')[0]).toBe('set-backend-prop');
    expect(catalog.suggest('list-backend')[0]).toBe('list-backends');
    expect(catalog.suggest('set-password-polcy-prop')[0]).toBe('set-password-policy-prop');
    expect(catalog.suggest('completely-unrelated-thing')).toEqual([]);
  });

  it('lists related subcommands in lifecycle order', () => {
    expect(catalog.relatedSubcommands('backend')).toEqual([
      'create-backend',
      'get-backend-prop',
      'set-backend-prop',
      'list-backends',
      'delete-backend',
    ]);
  });
});

describe('naming arguments', () => {
  it('infers the naming argument from the last word of the type', () => {
    expect(namingSpec('backend')).toEqual({ parents: [], self: '--backend-name', exact: false });
    expect(namingSpec('password-policy').self).toBe('--policy-name');
  });

  it('uses overrides for parents and irregular names', () => {
    expect(namingSpec('local-db-index')).toEqual({
      parents: ['--backend-name'],
      self: '--index-name',
      exact: true,
    });
    expect(namingSpec('virtual-attribute').self).toBe('--name');
    expect(namingSpec('replication-server')).toEqual({
      parents: ['--provider-name'],
      self: undefined,
      exact: true,
    });
  });

  it('treats configuration singletons as unnamed', () => {
    expect(isSingletonType('global-configuration')).toBe(true);
    expect(isSingletonType('backend')).toBe(false);
    expect(namingSpec('global-configuration')).toEqual({ parents: [], exact: true });
  });

  it('maps naming options back to object types', () => {
    expect(typesForNamingOption('--backend-name')).toEqual(['backend']);
    expect(typesForNamingOption('--provider-name').length).toBeGreaterThan(1);
  });
});

describe('helpers', () => {
  it('labels object types with acronyms', () => {
    expect(objectTypeLabel('local-db-vlv-index')).toBe('Local DB VLV Index');
    expect(objectTypeLabel('scim-resource-type')).toBe('SCIM Resource Type');
  });

  it('computes edit distance with transpositions', () => {
    expect(editDistance('backend', 'backend')).toBe(0);
    expect(editDistance('backend', 'bakcend')).toBe(1);
    expect(editDistance('crate', 'create')).toBe(1);
  });
});
