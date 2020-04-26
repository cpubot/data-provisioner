import * as E from 'fp-ts/lib/Either';
import * as O from 'fp-ts/lib/Option';

import { Proc, Sys, mkSys, isProc } from '../core/Proc';
import { Tree, collect } from '../util';

import { Runtime, mkRuntime } from './Runtime';
import { teardownPartial } from './Teardown';

const collectProcs = collect(isProc);

export type EvalMap = Map<number, unknown>;

// Public facing method for executing a set of procs within
// the same Sys context.
export const provision = (logger: Sys['logger']) => async (
  inputTree: Tree<Proc<unknown>>
): Promise<E.Either<unknown, Runtime>> => {
  // Create new Sys context.
  const sys = mkSys(logger);
  // Bind each proc to the Sys context.
  collectProcs(inputTree).map(({ proc }) => proc(sys));

  // Execute all the procs in the Sys context.
  const context = await sys.run();

  // If mutInterupt is set, there was an error.
  if (O.isSome(sys.mutInterrupt)) {
    // Implicit teardown of partial completion.
    await teardownPartial(context);
    return E.left(sys.mutInterrupt.value.e);
  }

  const successMap: EvalMap = new Map();
  for (const [id, v] of context) {
    successMap.set(id, (v as E.Right<unknown>).right);
  }

  return E.right(mkRuntime(successMap));
};
