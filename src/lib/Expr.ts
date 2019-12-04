import { EntitySchemas as ES, EntityType } from 'rival-api-sdk-js';
import { NonEmptyArray } from 'fp-ts/lib/NonEmptyArray';

import { id } from '../util/Resolvers';
import { first } from '../util/Pickers';
import { entityId } from '../util/Extractors';

type TagWithKey<TagName extends string, T> = {
  [K in keyof T]: { [_ in TagName]: K } & T[K];
};
type Unionize<T> = T[keyof T];

export type Resolver<E extends EntityType> = (
  entity: ES.TypeMap[E]
) => Promise<ES.TypeMap[E]>;
export type Picker<E extends EntityType> = (
  result: NonEmptyArray<ES.TypeMap[E]>
) => ES.TypeMap[E];
export type Extractor<E extends EntityType, R = unknown> = (
  entity: ES.TypeMap[E]
) => R;

type _ExprTable<E extends EntityType> = Readonly<
  TagWithKey<
    '_tag',
    {
      Lit: {
        _id: string;

        entityType: E;
        value: ES.TypeMap[E];
      };
      Query: {
        _id: string;

        entityType: E;
        query: Partial<AttrRecurse<E>>;
        picker: Picker<E>;
      };
      Create: {
        _id: string;

        entityType: E;
        query: Partial<AttrRecurse<E>>;
        resolver: Resolver<E>;
      };
    }
  >
>;

export type Expr<E extends EntityType> = Unionize<_ExprTable<E>>;
export type ExprFilter<
  E extends EntityType,
  Key extends keyof _ExprTable<E>
> = Unionize<
  {
    [K in Key]: _ExprTable<E>[K];
  }
>;

export type ExprExtractor<E extends EntityType> = Readonly<{
  _tag: 'ExprExtractor';
  expr: ExprFilter<E, 'Create' | 'Query' | 'Lit'>;
  extract: Extractor<E>;
}>;

export type RValue<E extends EntityType> = ExprExtractor<E> | string;
type Attr<E extends EntityType> = ES.TypeMap[E]['attributes'];

export type AttrRecurse<
  E extends EntityType,
  F extends (keyof Attr<E>)[] = (keyof Attr<E>)[]
> = Readonly<
  {
    [K in F[0]]:
      | ExprExtractor<any>
      | (Attr<E>[K] extends Record<string, unknown>
          ? { [K1 in keyof Attr<E>[K]]: ExprExtractor<any> | Attr<E>[K][K1] }
          : Attr<E>[K]);
  }
>;

let seed = 0;
const newId = () => `expr_${seed++}`;

export const lit = <E extends EntityType>(
  entityType: ExprFilter<E, 'Lit'>['entityType'],
  value: ExprFilter<E, 'Lit'>['value'],
  _id = newId()
): ExprFilter<E, 'Lit'> => ({
  _id,
  entityType,
  value,
  _tag: 'Lit',
});

export const query = <E extends EntityType>(
  entityType: ExprFilter<E, 'Query'>['entityType'],
  query: ExprFilter<E, 'Query'>['query'],
  picker: ExprFilter<E, 'Query'>['picker'] = first(),
  _id = newId()
): ExprFilter<E, 'Query'> => ({
  _id,
  entityType,
  query,
  picker,
  _tag: 'Query',
});

export const create = <E extends EntityType>(
  entityType: ExprFilter<E, 'Create'>['entityType'],
  query: ExprFilter<E, 'Create'>['query'],
  resolver: ExprFilter<E, 'Create'>['resolver'] = id(),
  _id = newId()
): ExprFilter<E, 'Create'> => ({
  _id,
  entityType,
  query,
  resolver,
  _tag: 'Create',
});

export const extract = <E extends EntityType>(
  expr: Expr<E>,
  extract: ExprExtractor<E>['extract'] = entityId()
): ExprExtractor<E> => ({
  _tag: 'ExprExtractor',
  expr,
  extract,
});

export const isExpr = <E extends EntityType>(e: any): e is Expr<E> =>
  e
    ? Object.getPrototypeOf(e) === Object.prototype &&
      ['_id', '_tag', 'entityType'].every(attr => e[attr] !== undefined)
    : false;
