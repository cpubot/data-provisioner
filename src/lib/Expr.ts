import { EntitySchemas as ES, EntityType } from 'rival-api-sdk-js';
import { NonEmptyArray } from 'fp-ts/lib/NonEmptyArray';

type TagWithKey<TagName extends string, T> = {
  [K in keyof T]: { [_ in TagName]: K } & T[K];
};
type Unionize<T> = T[keyof T];

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
        picker: (result: NonEmptyArray<ES.TypeMap[E]>) => ES.TypeMap[E];
      };
      Create: {
        _id: string;

        entityType: E;
        fields: Partial<AttrRecurse<E>>;
        resolver: (entity: ES.TypeMap[E]) => Promise<ES.TypeMap[E]>;
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
  expr: Expr<E>;
  extract: (entity: ES.TypeMap[E]) => unknown;
}>;

export type RValue<E extends EntityType> = ExprExtractor<E> | string;
type Attr<E extends EntityType> = ES.TypeMap[E]['attributes'];

export type AttrRecurse<
  E extends EntityType,
  F extends (keyof Attr<E>)[] = (keyof Attr<E>)[]
> = Readonly<
  {
    [K in F[0]]: ExprExtractor<any> | Attr<E>[K];
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
  picker: ExprFilter<E, 'Query'>['picker'] = results => results[0],
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
  fields: ExprFilter<E, 'Create'>['fields'],
  resolver: ExprFilter<E, 'Create'>['resolver'] = entity =>
    Promise.resolve(entity),
  _id = newId()
): ExprFilter<E, 'Create'> => ({
  _id,
  entityType,
  fields,
  resolver,
  _tag: 'Create',
});

export const extract = <E extends EntityType>(
  expr: Expr<E>,
  extract: ExprExtractor<E>['extract'] = e => e.id
): ExprExtractor<E> => ({
  expr,
  extract,
});
