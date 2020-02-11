import {
  Runtime,
  EvaluationContext,
  isExpr,
  FullyEvaluatedHistory,
  EvaluationContextAPI,
} from '../index';
import { isObject } from '../lib/Util';

const isValidEvaluationHistory = (e: any): e is FullyEvaluatedHistory<any> =>
  e
    ? isObject(e) && !isNaN(e.order) && isExpr(e.final) && isExpr(e.initial)
    : false;

export const jsonToRuntime = (runtimePayload: JSON): Runtime => {
  if (!Array.isArray(runtimePayload)) {
    throw new Error(`Invalid input`);
  }

  const evaluationContext: Map<
    string,
    FullyEvaluatedHistory<any>
  > = runtimePayload.reduce(
    (
      context: EvaluationContext,
      evaluationHistory: FullyEvaluatedHistory<any>
    ) => {
      if (!isValidEvaluationHistory(evaluationHistory)) {
        throw new Error(
          `Encountered invalid evaluation history: ${(JSON.stringify(
            evaluationHistory
          ),
          null,
          2)}`
        );
      }

      return context.set(evaluationHistory.initial._id, evaluationHistory);
    },
    new Map() as EvaluationContext
  );

  const getEvaluationHistory: EvaluationContextAPI['getEvaluationHistory'] = () =>
    Array.from(evaluationContext.values()).sort((a, b) => b.order - a.order);

  const getEvaluationHistoryFor: EvaluationContextAPI['getEvaluationHistoryFor'] = expr => {
    if (!evaluationContext.has(expr._id)) {
      throw new Error(
        `Expr not evaluated in given context: ${JSON.stringify(expr, null, 2)}`
      );
    }

    return evaluationContext.get(expr._id)!;
  };

  const get: Runtime['get'] = expr => getEvaluationHistoryFor(expr).final.value;

  const getQuery: Runtime['getQuery'] = expr =>
    getEvaluationHistoryFor(expr).query;

  return { getEvaluationHistory, get, getQuery };
};
