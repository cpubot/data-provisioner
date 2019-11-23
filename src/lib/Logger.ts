import {
  entityTypeToEntityTypeKey,
  EntityTypeKey,
  EntityType,
} from 'rival-api-sdk-js';
import { log } from 'fp-ts/lib/Console';
import { IO } from 'fp-ts/lib/IO';
import { Option, chain, some, none } from 'fp-ts/lib/Option';

import { Expr } from './Expr';

export type RequestType = 'Create' | 'Query' | 'Delete';

export type RequestLog = {
  _tag: 'Request';
  type: RequestType;
  entityType: EntityTypeKey;
  requestPayload: Record<string, unknown>;
};

export type ResponseLog = {
  _tag: 'Response';
  type: RequestType;
  entityType: EntityTypeKey;
  requestPayload: Record<string, unknown>;
  isError: boolean;
  responsePayload: unknown;
};

export type LogMessage = RequestLog | ResponseLog;

export type Formatter = (msg: LogMessage) => Option<string>;
export type Logger = (msg: LogMessage) => Option<void>;

export type CreateLogger = (
  l: (s: string) => IO<void>
) => (format: Formatter) => Logger;

export const createLogger: CreateLogger = l => format => msg =>
  chain<string, void>(msg => some(l(msg)()))(format(msg));

type CreateRequestLog = (
  entityType: EntityType
) => (
  requestPayload: RequestLog['requestPayload']
) => (type: RequestLog['type']) => RequestLog;

export const createRequestLog: CreateRequestLog = entityType => requestPayload => type => ({
  type,
  requestPayload,
  entityType: entityTypeToEntityTypeKey(entityType),
  _tag: 'Request',
});

type CreateRequestLogFromExpr = (
  expr: Expr<any>
) => (
  requestPayload: RequestLog['requestPayload']
) => (type: LogMessage['type']) => RequestLog;

export const createRequestLogFromExpr: CreateRequestLogFromExpr = ({
  entityType,
}) => createRequestLog(entityType);

type CreateResponseLog = (
  requestLog: RequestLog
) => (rest: { responsePayload: unknown; isError: boolean }) => ResponseLog;

export const createResponseLog: CreateResponseLog = ({
  type,
  entityType,
  requestPayload,
}) => ({ responsePayload, isError }) => ({
  type,
  entityType,
  requestPayload,
  isError,
  responsePayload,
  _tag: 'Response',
});

export const defaultFormatter: Formatter = msg => {
  switch (msg._tag) {
    case 'Request':
      return some(
        `${msg.type}: ${msg.entityType}: ${JSON.stringify(msg.requestPayload)}`
      );
    case 'Response':
      if (!msg.isError) {
        return none;
      }

      return some(
        `ERROR — ${JSON.stringify(msg.responsePayload, null, 2)}\nVia ${
          msg.type
        }: ${msg.entityType}: ${JSON.stringify(msg.requestPayload)}`
      );
  }
};

export const defaultLogger = createLogger(log)(defaultFormatter);
export const devNullLogger = createLogger(s => () => {})(defaultFormatter);
