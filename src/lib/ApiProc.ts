import * as NonEmptyArray from 'fp-ts/lib/NonEmptyArray';
import { pipe } from 'fp-ts/lib/pipeable';
import { array } from 'fp-ts/lib/Array';
import * as O from 'fp-ts/lib/Option';
import * as E from 'fp-ts/lib/Either';
import { Refinement } from 'fp-ts/lib/function';

import rivalApiSdkJs from 'rival-api-sdk-js';
import { MessageHandler } from 'rival-api-sdk-js/dist/services/PublicEntitySync';
import {
  EntityType,
  Entity,
  snakeCaseToEntityType,
  entityTypeToEntityTypeKey,
  EntitySchemas as ES,
} from 'ts-api-types';

import {
  Proc,
  proc,
  chain,
  map,
  isProc,
  sequenceT,
  mkExogenousError,
  mkProc,
  mkPreempt,
} from '../core/Proc';
import { mapTree, collect } from '../util';

import * as Api from './Api';

// This module exposes a set of semantic helpers and conveniences
// around the API helpers.

// Type which ecapsulates the syntactic sugar which facilitates nesting
// proc instances as query parameter values.
type QueryAttributes<E extends EntityType> = Partial<
  {
    [K in keyof Api.Attr<E>]: Api.Attr<E>[K] extends Record<any, any> | any[]
      ? {
          [K1 in keyof Api.Attr<E>[K]]:
            | Proc<Api.Attr<E>[K][K1]>
            | Api.Attr<E>[K][K1];
        }
      : Proc<Api.Attr<E>[K]> | Api.Attr<E>[K];
  }
>;

// Helper for generating a Proc signature with the correct API response
// for a given Entity type.
// e.g.:
// ```
// ApiProc<ES.Event>
// ```
export type ApiProc<
  E extends Entity | NonEmptyArray.NonEmptyArray<Entity> = Entity
> = Proc<Api.Response<E>>;

const collectProcs = collect(isProc);
const mapProcTree = mapTree(isProc);

// Helper which transforms an API query object with nested proc
// values into a composite proc which resolves to the fully hydrated
// query object.
const mkQueryProc = <E extends EntityType>(
  q1: QueryAttributes<E>
): Proc<Partial<Api.Attr<E>>> => {
  const procList = collectProcs(q1);
  const reverseIndexMap: Map<number, number> = procList.reduce(
    (map, { id }, index) => map.set(id, index),
    new Map()
  );

  return pipe(
    array.sequence(proc)(procList),
    map((values) => {
      const treeMapper = mapProcTree((a) => {
        if (!reverseIndexMap.has(a.id)) {
          throw new Error(
            `Query transformation failed.\n${a} was not evaluated.`
          );
        }
        return values[reverseIndexMap.get(a.id)!];
      });

      return Object.entries(q1).reduce(
        (q2, [key, value]) => ({
          ...q2,
          [key]: treeMapper(value),
        }),
        {} as Partial<Api.Attr<E>>
      );
    })
  );
};

export const create = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) => pipe(mkQueryProc(query), chain(Api.create(entityType)));

export const clone = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) => pipe(mkQueryProc(query), chain(Api.clone(entityType)));

export const update = <E extends EntityType>(
  entityType: E,
  idProc: Proc<string> | string,
  query: QueryAttributes<E>
) =>
  pipe(
    sequenceT(mkQueryProc(query), isProc(idProc) ? idProc : proc.of(idProc)),
    chain(([q, id]) => Api.update(entityType, id)(q))
  );

export const upload = <E extends EntityType>(
  entityType: E,
  file: Buffer | ArrayBuffer | File,
  query: QueryAttributes<E>,
  headers: Record<string, any> = {}
) => pipe(mkQueryProc(query), chain(Api.upload(entityType, file, headers)));

const unsafeList = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) => pipe(mkQueryProc(query), chain(Api.list(entityType)));

export const list = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) =>
  pipe(
    unsafeList(entityType, query),
    map((response) => {
      const nonEmpty = NonEmptyArray.fromArray(response.result);
      if (O.isNone(nonEmpty)) {
        throw new Error(
          `Expected list result not to be empty.\nQuery: ${entityTypeToEntityTypeKey(
            entityType
          )} ${JSON.stringify(response.query)} returned no results.`
        );
      }
      return { ...response, result: nonEmpty.value };
    })
  );

export const first = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) =>
  pipe(
    list(entityType, query),
    map((response) => ({ ...response, result: response.result[0] }))
  );

export const query = first;

export const last = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) =>
  pipe(
    list(entityType, query),
    map((response) => ({
      ...response,
      result: NonEmptyArray.last(response.result),
    }))
  );

export const poll = <E extends EntityType, A extends Api.Schema<E>[]>(
  entityType: E,
  query: QueryAttributes<E>,
  until: Refinement<Api.Schema<E>[], A>
) => pipe(mkQueryProc(query), chain(Api.poll(entityType, until)));

export const pollUntilNonEmpty = <E extends EntityType>(
  entityType: E,
  query: QueryAttributes<E>
) =>
  pipe(
    mkQueryProc(query),
    chain(
      Api.poll(entityType, (ar): ar is NonEmptyArray.NonEmptyArray<
        Api.Schema<E>
      > => O.isSome(NonEmptyArray.fromArray(ar)))
    )
  );

export const pollFirst = <E extends EntityType, A extends Api.Schema<E>>(
  entityType: E,
  query: QueryAttributes<E>,
  until: Refinement<Api.Schema<E>, A>
) =>
  pipe(
    mkQueryProc(query),
    chain(
      Api.poll(entityType, (ar): ar is typeof ar & { [0]: A } => {
        const nonEmpty = NonEmptyArray.fromArray(ar);
        if (O.isNone(nonEmpty)) {
          return false;
        }
        return until(nonEmpty.value[0]);
      })
    ),
    map((response) => ({
      ...response,
      result: response.result[0],
    }))
  );

export const pollFirstUntilNonEmpty = <E extends keyof ES.TypeMap>(
  entityType: E,
  query: QueryAttributes<E>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
) => pollFirst(entityType, query, (a): a is Api.Schema<E> => true);

const untilEntityInstance = <E extends Entity, A extends E>(
  until: Refinement<E, A>
) => (entity: E) =>
  pollFirst(
    snakeCaseToEntityType(entity.type) as any,
    { id: entity.id },
    until
  );

export const untilEntity = <E extends Entity, A extends E>(
  until: Refinement<E, A>
) => (proc: ApiProc<E>) =>
  pipe(
    proc,
    chain((response) =>
      pipe(
        untilEntityInstance(until)(response.result),
        map((p1) => ({ ...response, result: p1.result }))
      )
    )
  );

type NonNullary<T> = T extends null ? never : T extends undefined ? never : T;

type EntityWithNonNullaryAttributes<
  E extends Entity,
  K extends keyof E['attributes']
> = E & {
  attributes: Required<
    {
      [K1 in K]: NonNullary<E['attributes'][K1]>;
    }
  >;
};

export const untilHasAttrs = <
  E extends Entity,
  K extends (keyof E['attributes'])[]
>(
  ks: K
) =>
  untilEntity<E, EntityWithNonNullaryAttributes<E, K[0]>>(
    (e): e is EntityWithNonNullaryAttributes<E, K[0]> =>
      ks.every(
        (k) =>
          (e.attributes as E['attributes'])[k] !== null &&
          (e.attributes as E['attributes'])[k] !== undefined
      )
  );

export function extract<E extends Entity | NonEmptyArray.NonEmptyArray<Entity>>(
  p: ApiProc<E>
): Proc<string>;
export function extract<
  E extends Entity | NonEmptyArray.NonEmptyArray<Entity>,
  A
>(p: ApiProc<E>, f: (e: E) => A): Proc<A>;
export function extract<
  E extends Entity | NonEmptyArray.NonEmptyArray<Entity>,
  A
>(p: ApiProc<E>, f?: (e: E) => A) {
  return proc.map(p, ({ result }) =>
    f !== undefined
      ? f(result)
      : Array.isArray(result)
      ? (result[0] as Entity).id
      : (result as Entity).id
  );
}

export const awaitTransaction = ({
  timeout = 30000,
  rejectOnTimeout = true,
}: { timeout?: number; rejectOnTimeout?: boolean } = {}) => <
  E extends Entity | NonEmptyArray.NonEmptyArray<Entity>
>(
  proc: ApiProc<E>
): ApiProc<E> =>
  pipe(
    proc,
    chain((response) =>
      mkProc((r) => () =>
        new Promise((resolve) => {
          const entitySync = rivalApiSdkJs.instance().getEntitySyncService();

          const timer = setTimeout(() => {
            unbind();
            if (rejectOnTimeout) {
              resolve(
                E.left(
                  mkExogenousError(
                    `awaitTransaction Resolver for ${
                      Array.isArray(response.result)
                        ? (response.result[0] as Entity).type
                        : (response.result as Entity).type
                    }: ${JSON.stringify(
                      response.result,
                      null,
                      2
                    )} timed out.\nTIMEOUT=${timeout}ms\nTransaction ID: ${
                      response.txId
                    }`
                  )
                )
              );
            } else {
              resolve(E.right(response));
            }
          }, timeout);

          const monitorTerminateSignal = setInterval(() => {
            if (r.shouldPreempt()) {
              unbind();
              resolve(E.left(mkPreempt()));
            }
          }, 1000);

          const unbind = () => {
            clearTimeout(timer);
            clearInterval(monitorTerminateSignal);
            entitySync.offMessage(handleMessage);
          };

          const handleMessage: MessageHandler = (event) => {
            if (
              event.data.some(
                ({ meta: { transaction_id } }) =>
                  response.txId === transaction_id
              )
            ) {
              unbind();
              resolve(E.right(response));
            }
          };

          entitySync.onMessage(handleMessage);
        })
      )
    )
  );
