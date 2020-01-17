import rivalApiSdkJs, {
  EntityType,
  EntitySchemas as ES,
  entityTypeToEntityTypeKey,
} from 'rival-api-sdk-js';
import { Either, left, right } from 'fp-ts/lib/Either';
import { NonEmptyArray, fromArray } from 'fp-ts/lib/NonEmptyArray';
import { isNone } from 'fp-ts/lib/Option';

import { Expr, isExpr } from './Expr';
import { createContext, evaluate, EvaluationContextAPI } from './Evaluator';
import {
  ApiRequestLogger,
  createRequestLog,
  createResponseLog,
} from './Logger';
import { isObject } from './Util';

export type Runtime = Readonly<{
  get: <E extends EntityType>(alg: Expr<E>) => ES.TypeMap[E];
  getEvaluationHistory: EvaluationContextAPI['getEvaluationHistory'];
}>;

const createRuntime = (context: EvaluationContextAPI): Runtime => ({
  get: expr => context.getEvaluationHistoryFor(expr).final.value,
  getEvaluationHistory: context.getEvaluationHistory,
});

export type Recipe = Expr<any>[] | Record<string, Expr<any>>;

export const isRecipe = (r: any): r is Recipe =>
  (Array.isArray(r) && r.every(isExpr)) ||
  (isObject(r) && Object.values(r).every(isExpr));

export const provision = (logger: ApiRequestLogger) => (
  args: Recipe
): Promise<Either<[Runtime, Error], Runtime>> => {
  const exprs = Array.isArray(args) ? args : Object.values(args);

  const evaluationContext = createContext();
  const evaluator = evaluate(logger)(evaluationContext);
  const runtime = createRuntime(evaluationContext);

  return Promise.all(exprs.map(evaluator))
    .then(() => right(runtime))
    .catch(e => left([runtime, e]));
};

export const teardown = (logger: ApiRequestLogger) => async (
  runtime: Runtime
): Promise<Either<NonEmptyArray<Error>, void>> => {
  const history = runtime.getEvaluationHistory();

  const errors: Error[] = [];

  for (const evaluation of history) {
    const {
      initial,
      final: {
        entityType,
        value: { id },
      },
    } = evaluation;

    switch (initial._tag) {
      case 'Create': {
        const requestLog = createRequestLog(entityType)({ id })('Delete');
        const responseLog = createResponseLog(requestLog);
        logger(requestLog);

        await rivalApiSdkJs
          .instance()
          .entityClient(entityTypeToEntityTypeKey(entityType))
          .delete(id)
          .getPromise()
          .then(r => {
            logger(responseLog({ responsePayload: r, isError: false }));
          })
          .catch(e => {
            errors.push(e);
            logger(responseLog({ responsePayload: e, isError: true }));
          });
      }
      default:
        continue;
    }
  }

  const nonEmptyErrors = fromArray(errors);
  if (isNone(nonEmptyErrors)) {
    return right(undefined);
  }

  return left(nonEmptyErrors.value);
};
