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

import { Logger, createRequestLogFromExpr, createResponseLog } from './Logger';

type EvaluationHistory<E extends EntityType> = Readonly<{
  initial: Expr<E>;
  final?: ExprFilter<E, 'Lit'>;
  order?: number;
}>;

type FullyEvaluatedHistory<E extends EntityType> = Required<
  EvaluationHistory<E>
>;

export type EvaluationContextAPI = {
  initial: (expr: Expr<any>) => void;
  final: (expr: ExprFilter<any, 'Lit'>, order: number) => void;
  getEvaluationHistoryFor: <E extends EntityType>(
    expr: Expr<E>
  ) => FullyEvaluatedHistory<E>;
  getEvaluationHistory: () => FullyEvaluatedHistory<any>[];
  unsafeGet: <E extends EntityType>(
    expr: Expr<E>
  ) => EvaluationHistory<E> | undefined;
};

type EvaluationContext = Map<string, EvaluationHistory<any>>;

export const createContext = (
  context: EvaluationContext = new Map()
): EvaluationContextAPI => {
  const has = (expr: Expr<any>) => (prop: keyof EvaluationHistory<any>) =>
    context.has(expr._id) && context.get(expr._id)![prop] !== undefined;

  const preventDuplicate = (expr: Expr<any>) => (
    prop: keyof EvaluationHistory<any>
  ) => {
    if (has(expr)(prop)) {
      throw new Error(
        `Duplicate ${prop} value for Expr: ${JSON.stringify(expr, null, 2)}`
      );
    }
  };

  const initial: EvaluationContextAPI['initial'] = expr => {
    preventDuplicate(expr)('initial');

    context.set(expr._id, { initial: expr });
  };

  const final: EvaluationContextAPI['final'] = (expr, order) => {
    preventDuplicate(expr)('final');

    context.set(expr._id, {
      order,
      ...(context.get(expr._id) || { initial: expr }),
      final: expr,
    });
  };

  const evalCompleted = (
    e: EvaluationHistory<any>
  ): e is FullyEvaluatedHistory<any> => {
    return (['final', 'initial', 'order'] as (keyof FullyEvaluatedHistory<
      any
    >)[]).every(key => e[key] !== undefined);
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
  t ? Object.getPrototypeOf(t) === Object.prototype : false;

const evalSubqueries = (logger: Logger) => (context: EvaluationContextAPI) => <
  E extends EntityType
>(
  query: Partial<AttrRecurse<E>>
) => {
  type Key = string;
  type Value = string;

  const kvPromiseTuples = Object.entries(query).reduce(
    (promises, [key, val]: [string, RValue<any>]) =>
      isExprExtractor(val)
        ? [
            ...promises,
            evaluate(logger)(context)(val.expr).then(
              e => [key, val.extract(e.value)] as [Key, Value]
            ),
          ]
        : promises,
    [] as Promise<[Key, Value]>[]
  );

  return Promise.all(kvPromiseTuples).then(values =>
    values.reduce((obj, [key, value]) => {
      obj[key] = value;
      return obj;
    }, {} as Record<string, string>)
  );
};

const evalQuery = (logger: Logger) => (context: EvaluationContextAPI) => async <
  E extends EntityType
>(
  query: Partial<AttrRecurse<E>>
) => {
  const evaluatedSubqueries = await evalSubqueries(logger)(context)(query);

  return Object.entries(query).reduce(
    (newQuery, [key, val]: [string, RValue<any>]) => {
      if (isExprExtractor(val)) {
        newQuery[key] = evaluatedSubqueries[key];
      } else {
        newQuery[key] = (query as any)[key];
      }
      return newQuery;
    },
    {} as Record<string, string>
  );
};

let ord = 0;
const nextOrd = () => ord++;

export const evaluate = (logger: Logger) => (
  context: EvaluationContextAPI
) => async <E extends EntityType>(
  expr: Expr<E>
): Promise<ExprFilter<E, 'Lit'>> => {
  // Check if expr has already been evaluated in this context
  const contextValue = context.unsafeGet(expr);
  if (contextValue && contextValue.final) {
    // Return evaluated expr. Short-circuit evaluation logic.
    return contextValue.final;
  }

  switch (expr._tag) {
    case 'Lit':
      context.final(expr, nextOrd());

      return expr;
    case 'Query': {
      context.initial(expr);

      const query = await evalQuery(logger)(context)(expr.query);

      const requestLog = createRequestLogFromExpr(expr)(query)('Query');
      const responseLog = createResponseLog(requestLog);

      logger(requestLog);

      return (rivalApiSdkJs
        .instance()
        .entityClient(entityTypeToEntityTypeKey(expr.entityType))
        .list(query) as Transaction<ES.TypeMap[E][]>)
        .getPromise()
        .then(value => {
          const nonEmptyValue = fromArray(value);

          if (!isNone(nonEmptyValue)) {
            logger(responseLog({ responsePayload: value, isError: false }));

            return evaluate(logger)(context)(
              lit(expr.entityType, expr.picker(nonEmptyValue.value), expr._id)
            );
          }

          logger(responseLog({ responsePayload: value, isError: true }));

          throw new Error(
            `Query Expr returned empty result ${JSON.stringify(expr, null, 2)}`
          );
        })
        .catch(e => {
          logger(responseLog({ responsePayload: e, isError: true }));

          throw new Error(`Query Expr failed ${JSON.stringify(expr, null, 2)}`);
        });
    }
    case 'Create': {
      context.initial(expr);

      const fields = await evalQuery(logger)(context)(expr.fields);

      const requestLog = createRequestLogFromExpr(expr)(fields)('Create');
      const responseLog = createResponseLog(requestLog);

      logger(requestLog);

      return (rivalApiSdkJs
        .instance()
        .entityClient(entityTypeToEntityTypeKey(expr.entityType))
        .create(fields) as Transaction<ES.TypeMap[E]>)
        .getPromise()
        .then(value =>
          expr.resolver(value).then(resolvedValue => {
            logger(
              responseLog({ responsePayload: resolvedValue, isError: false })
            );

            return evaluate(logger)(context)(
              lit(expr.entityType, resolvedValue, expr._id)
            );
          })
        )
        .catch(e => {
          logger(responseLog({ responsePayload: e, isError: true }));

          throw new Error(
            `Create Expr failed ${JSON.stringify(expr, null, 2)}`
          );
        });
    }
  }
};
