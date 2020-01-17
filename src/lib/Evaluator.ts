import rivalApiSdkJs, {
  EntityType,
  EntitySchemas as ES,
  entityTypeToEntityTypeKey,
  Transaction,
} from 'rival-api-sdk-js';
import { fromArray } from 'fp-ts/lib/NonEmptyArray';
import { isNone } from 'fp-ts/lib/Option';

import {
  Expr,
  AttrRecurse,
  RValue,
  ExprExtractor,
  ExprFilter,
  lit,
} from './Expr';

import {
  ApiRequestLogger,
  createRequestLogFromExpr,
  createResponseLog,
} from './Logger';

import { isObject } from './Util';

export type EvaluationHistory<E extends EntityType> = Readonly<{
  initial: Expr<E>;
  evaluationPromise: Promise<ExprFilter<E, 'Lit'>>;
  final?: ExprFilter<E, 'Lit'>;
  order?: number;
}>;

export type FullyEvaluatedHistory<E extends EntityType> = Required<
  EvaluationHistory<E>
>;

export const evalCompleted = <E extends EntityType>(
  e: EvaluationHistory<E>
): e is FullyEvaluatedHistory<E> =>
  (['final', 'initial', 'order'] as (keyof FullyEvaluatedHistory<E>)[]).every(
    key => e[key] !== undefined
  );

export type EvaluationContextAPI = {
  initial: <E extends EntityType, P extends Promise<ExprFilter<E, 'Lit'>>>(
    expr: Expr<E>,
    evaluationPromise: P
  ) => P;
  final: <E extends EntityType, Expr extends ExprFilter<E, 'Lit'>>(
    expr: Expr,
    order: number
  ) => Expr;
  getEvaluationHistoryFor: <E extends EntityType>(
    expr: Expr<E>
  ) => FullyEvaluatedHistory<E>;
  getEvaluationHistory: () => FullyEvaluatedHistory<any>[];
  unsafeGet: <E extends EntityType>(
    expr: Expr<E>
  ) => EvaluationHistory<E> | undefined;
};

export type EvaluationContext = Map<string, EvaluationHistory<any>>;

export const createContext = (
  context: EvaluationContext = new Map()
): EvaluationContextAPI => {
  const has = <E extends EntityType>(expr: Expr<E>) => (
    prop: keyof EvaluationHistory<E>
  ) => context.has(expr._id) && context.get(expr._id)![prop] !== undefined;

  const preventDuplicate = <E extends EntityType>(expr: Expr<E>) => (
    prop: keyof EvaluationHistory<E>
  ) => {
    if (has(expr)(prop)) {
      throw new Error(
        `Duplicate ${prop} value for Expr: ${JSON.stringify(expr, null, 2)}`
      );
    }
  };

  const initial: EvaluationContextAPI['initial'] = (
    expr,
    evaluationPromise
  ) => {
    preventDuplicate(expr)('initial');

    context.set(expr._id, { initial: expr, evaluationPromise });

    return evaluationPromise;
  };

  const final: EvaluationContextAPI['final'] = (expr, order) => {
    preventDuplicate(expr)('final');

    context.set(expr._id, {
      order,
      ...(context.get(expr._id) || {
        initial: expr,
        evaluationPromise: Promise.resolve(expr),
      }),
      final: expr,
    });

    return expr;
  };

  const getEvaluationHistoryFor: EvaluationContextAPI['getEvaluationHistoryFor'] = <
    E extends EntityType
  >(
    expr: Expr<E>
  ) => {
    const evaluation = context.get(expr._id);
    if (!evaluation) {
      throw new Error(
        `Expr was not evaluated within context: ${JSON.stringify(
          expr,
          null,
          2
        )}`
      );
    }

    if (!evalCompleted(evaluation)) {
      throw new Error(
        `Expr was not fully evaluated: ${JSON.stringify(expr, null, 2)}`
      );
    }

    return evaluation;
  };

  const unsafeGet: EvaluationContextAPI['unsafeGet'] = expr =>
    context.get(expr._id);

  const getEvaluationHistory: EvaluationContextAPI['getEvaluationHistory'] = () =>
    Array.from(context.values())
      .filter(evalCompleted)
      .sort((a, b) => b.order - a.order);

  return {
    initial,
    final,
    getEvaluationHistoryFor,
    getEvaluationHistory,
    unsafeGet,
  };
};

const isExprExtractor = <E extends EntityType>(
  t: RValue<E>
): t is ExprExtractor<E> =>
  t ? isObject(t) && t._tag === 'ExprExtractor' : false;

const containsNestedExprExtractor = (t: Record<string, any>) =>
  t ? isObject(t) && Object.values(t).some(isExprExtractor) : false;

const evalSubqueries = (logger: ApiRequestLogger) => (
  context: EvaluationContextAPI
) => <E extends EntityType>(query: Partial<AttrRecurse<E>>) => {
  type Key = string;
  type Value = string | Record<string, string>;

  const kvPromiseTuples = Object.entries(query).reduce(
    (promises, [key, val]) => {
      if (isExprExtractor(val)) {
        return [
          ...promises,
          evaluate(logger)(context)(val.expr).then(
            e => [key, val.extract(e.value)] as [Key, Value]
          ),
        ];
      }

      if (containsNestedExprExtractor(val)) {
        return [
          ...promises,
          evalQuery(logger)(context)(val).then(e => [key, e] as [Key, Value]),
        ];
      }

      return promises;
    },
    [] as Promise<[Key, Value]>[]
  );

  return Promise.all(kvPromiseTuples).then(values =>
    values.reduce((obj, [key, value]) => {
      obj[key] = value;
      return obj;
    }, {} as Record<Key, Value>)
  );
};

const evalQuery = (logger: ApiRequestLogger) => (
  context: EvaluationContextAPI
) => async <E extends EntityType>(query: Partial<AttrRecurse<E>>) => {
  const evaluatedSubqueries = await evalSubqueries(logger)(context)(query);

  return Object.entries(query).reduce(
    (newQuery, [key, val]: [string, RValue<any>]) => {
      if (evaluatedSubqueries[key]) {
        newQuery[key] = evaluatedSubqueries[key];
      } else {
        newQuery[key] = (query as any)[key];
      }
      return newQuery;
    },
    {} as Record<string, string | Record<string, string>>
  );
};

let ord = 0;
const nextOrd = () => ord++;

export const evaluate = (logger: ApiRequestLogger) => (
  context: EvaluationContextAPI
) => <E extends EntityType>(expr: Expr<E>): Promise<ExprFilter<E, 'Lit'>> => {
  // Check if expr has already been evaluated in this context
  const initialValue = context.unsafeGet(expr);
  if (initialValue && initialValue.initial._tag === expr._tag) {
    return initialValue.evaluationPromise;
  }

  switch (expr._tag) {
    case 'Lit':
      return Promise.resolve(context.final(expr, nextOrd()));

    case 'Query':
      return context.initial(
        expr,
        (async () => {
          const query = await evalQuery(logger)(context)(expr.query);

          const requestLog = createRequestLogFromExpr(expr)(query)('Query');
          const responseLog = createResponseLog(requestLog);

          logger(requestLog);

          return (rivalApiSdkJs
            .instance()
            .entityClient(entityTypeToEntityTypeKey(expr.entityType))
            .list(query as any) as Transaction<ES.TypeMap[E][]>)
            .getPromise()
            .then(value => {
              const nonEmptyValue = fromArray(value);

              if (!isNone(nonEmptyValue)) {
                logger(responseLog({ responsePayload: value, isError: false }));

                return evaluate(logger)(context)(
                  lit(
                    expr.entityType,
                    expr.picker(nonEmptyValue.value),
                    expr._id
                  )
                );
              }

              logger(responseLog({ responsePayload: value, isError: true }));

              throw new Error(
                `Query Expr returned empty result:\n\nQuery: ${
                  EntityType[expr.entityType]
                } ${JSON.stringify(query, null, 2)}\n\nExpr: ${JSON.stringify(
                  expr,
                  null,
                  2
                )}`
              );
            })
            .catch(e => {
              logger(responseLog({ responsePayload: e, isError: true }));

              throw new Error(
                `Query Expr failed:\n\nQuery: ${
                  EntityType[expr.entityType]
                } ${JSON.stringify(query, null, 2)}\n\nError: ${
                  e instanceof Error ? e.message : JSON.stringify(e, null, 2)
                }\n\nExpr: ${JSON.stringify(expr, null, 2)}`
              );
            });
        })()
      );

    case 'Create':
      return context.initial(
        expr,
        (async () => {
          const query = await evalQuery(logger)(context)(expr.query);

          const requestLog = createRequestLogFromExpr(expr)(query)('Create');
          const responseLog = createResponseLog(requestLog);

          logger(requestLog);

          const tx = rivalApiSdkJs
            .instance()
            .entityClient(entityTypeToEntityTypeKey(expr.entityType))
            .create(query) as Transaction<ES.TypeMap[E]>;

          return tx
            .getPromise()
            .then(value =>
              expr.resolver(value, tx.getId()).then(resolvedValue => {
                logger(
                  responseLog({
                    responsePayload: resolvedValue,
                    isError: false,
                  })
                );

                return evaluate(logger)(context)(
                  lit(expr.entityType, resolvedValue, expr._id)
                );
              })
            )
            .catch(e => {
              logger(responseLog({ responsePayload: e, isError: true }));

              throw new Error(
                `Create Expr failed\n\nQuery: ${
                  EntityType[expr.entityType]
                } ${JSON.stringify(query, null, 2)}\n\nError: ${
                  e instanceof Error ? e.message : JSON.stringify(e, null, 2)
                }\n\nExpr: ${JSON.stringify(expr, null, 2)}`
              );
            });
        })()
      );

    case 'Update':
      return context.initial(
        expr,
        (async () => {
          const { entityId: entityIdOrExpr } = expr;
          const entityId = isExprExtractor(entityIdOrExpr)
            ? await evaluate(logger)(context)(entityIdOrExpr.expr).then(
                e => entityIdOrExpr.extract(e.value) as string
              )
            : entityIdOrExpr;

          const query = await evalQuery(logger)(context)(expr.query);

          const requestLog = createRequestLogFromExpr(expr)(query)('Update');
          const responseLog = createResponseLog(requestLog);

          logger(requestLog);

          const tx = rivalApiSdkJs
            .instance()
            .entityClient(entityTypeToEntityTypeKey(expr.entityType))
            .update({ id: entityId, attributes: query }) as Transaction<
            ES.TypeMap[E]
          >;

          return tx
            .getPromise()
            .then(value =>
              expr.resolver(value, tx.getId()).then(resolvedValue => {
                logger(
                  responseLog({
                    responsePayload: resolvedValue,
                    isError: false,
                  })
                );

                return evaluate(logger)(context)(
                  lit(expr.entityType, resolvedValue, expr._id)
                );
              })
            )
            .catch(e => {
              logger(responseLog({ responsePayload: e, isError: true }));

              throw new Error(
                `Update Expr failed\n\nQuery: ${
                  EntityType[expr.entityType]
                } ${JSON.stringify(query, null, 2)}\n\nError: ${
                  e instanceof Error ? e.message : JSON.stringify(e, null, 2)
                }\n\nExpr: ${JSON.stringify(expr, null, 2)}`
              );
            });
        })()
      );
  }
};
