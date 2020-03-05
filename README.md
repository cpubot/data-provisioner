# Data Provisioner

A framework for declaratively specifying environment data requirements and an associated runtime for evaluating and fulfilling those requirements.

## Motivation

The automation of acceptance tests is a crucial step towards achieving scalable and reliable continuous deployment and integration across software services. Perhaps the trickiest part of authoring automated acceptance tests is ensuring that the environment in which a test is executing exists in a specific state.

This framework aims to do the following:

- Allow developers to express environment state in a declarative way.
- Decouple environment state declarations from environment state provisioning (thus enabling code sharing between environment state declarations).
- Automate inversion of environment state once tests are completed (no more side-effecty test set-up).

## Installation

```
yarn add data-provisioner
```

## Design

This framework exposes two key abstractions:

- [Expression combinators](#expression-combinators)
  - An [embedded domain specific language](https://en.wikipedia.org/wiki/Domain-specific_language#External_and_Embedded_Domain_Specific_Languages) (EDSL) with which developers will compose an environment state.
- [Environment runtime](#environment-runtime)
  - EDSL interpreter and environment interface.

## Expression Combinators

A set of functions used to describe how various API entities should be provisioned.

- [`create`](#create)
- [`query`](#query)
- [`extract`](#extract)
- [`createSpec`](#createspec)

#### Relevant types

> The following types will be referenced in forthcoming type signatures. You'll likely never need to use these — they're outlined here for reference.

##### `EntityType`:

An `enum` enumerating all available entity types from the Rival APIs. [Defined in `ts-api-types`](https://github.com/10eTechnology/ts-api-types/blob/master/types/EntityType.ts)

Example:

```typescript
import { EntityType } from 'ts-api-types';

type Event = EntityType.Event;
```

##### `ES.TypeMap`:

A type constructor which returns an `EntityType`'s associated schema. [Defined in the `ts-api-types`](https://github.com/10eTechnology/ts-api-types/blob/master/types/EntitySchemas.ts)

Example:

```typescript
import { EntityType, EntitySchemas as ES } from 'ts-api-types';

type EventSchema = ES.TypeMap[EntityType.Event];
```

##### `AttrRecurse`:

A type constructor which returns a type denoting all available fields for a particular `EntityType`. Field values _can_ be a reference to another expression (using the `extract` combinator).

```typescript
import { EntityType, EntitySchemas as ES } from 'ts-api-types';

type Attr<E extends EntityType> = ES.TypeMap[E]['attributes'];

type AttrRecurse<E extends EntityType> = {
  [K in Attr<E>]: ExprExtractor<any> | Attr<E>[K];
};
```

Where `ExprExtractor` denotes any nested `extract` calls.

##### `Expr`:

A type constructor which returns expression combinator parameterized by an `EntityType`.

## Create

A function used to indicate that an entity should be created with a given set of attributes. Accepts an optional [`resolver`](https://github.com/10eTechnology/data-provisioner/blob/master/src/lib/Expr.ts#L13) parameter which can be used to encode custom resolution logic.

```typescript
function create<E extends EntityType>(
  entityType: E,
  fields: AttrRecurse<E>,
  resolver?: (
    entity: ES.TypeMap[E],
    transactionId: string
  ) => Promise<ES.TypeMap[E]>
): Expr<E>;
```

Examples:

```typescript
import { create } from 'data-provisioner';

const deliveryMethod = create(EntityType.DeliveryMethod, {
  name: 'My Delivery Method',
  deliveryProcess: 'DIGITAL_IN_APP',
});
```

With `resolver`:

```typescript
import { create } from 'data-provisioner';

const deliveryMethod = create(
  EntityType.DeliveryMethod,
  {
    name: 'My Delivery Method',
    deliveryProcess: 'DIGITAL_IN_APP',
  },
  // You'll likely want to do something more interesting than this.
  deliveryMethod => Promise.resolve(deliveryMethod)
  // Where `deliveryMethod` is an instance of the DeliveryMethod entity.
);
```

See [Built-in Resolvers](#built-in-resolvers) for more documentation on additional resolvers that are available.

## Query

A function used to indicate that an entity already exists in the environment. This _should_ generally be avoided if at all possible, but exists as a sort of escape hatch for the time being. Accepts an optional `picker` argument in the event that your query returns more than one result and you'd like to implement some custom result picking logic. By default the runtime will pick the first result.

```typescript
function query<E extends EntityType>(
  entityType: EntityType,
  query: AttrRecurse<E>,
  picker?: (result: NonEmptyArray<ES.TypeMap[E]>) => ES.TypeMap[E]
): Expr<E>;
```

Note that `picker` injects a `NonEmptyArray` of results. It is considered an invariant of the runtime — the runtime will `throw` if any query returns an empty result set.

Examples:

```typescript
import { query } from 'data-provisioner';
import { EntityType } from 'ts-api-types';

const productDistribution = query(EntityType.ProductDistribution, {
  name: 'NUG_P_SEA',
});
```

With `picker`:

```typescript
import { query } from 'data-provisioner';
import { EntityType } from 'ts-api-types';

const productDistribution = query(
  EntityType.ProductDistribution,
  {},
  // Pick the last item
  results => results[results.length - 1]
);
```

## Extract

A function used to indicate that the resulting entity of a given expression evaluation should be used as a parameter to another expression. Accepts an optional `extract` parameter which allows specifying which attribute to pluck off the referenced entity — defaults to plucking off the entity's `id`.

This is essentially the "glue" between expressions.

```typescript
function extract<E extends EntityType>(
  expr: Expr<E>,
  extract?: (entity: ES.TypeMap[E]) => unknown;
): ExprExtractor<E>;
```

Examples:

```typescript
import { query, create, extract } from 'data-provisioner';
import { EntityType } from 'ts-api-types';

const deliveryMethod = create(EntityType.DeliveryMethod, {
  name: 'My Delivery Method',
  deliveryProcess: 'DIGITAL_IN_APP',
});

const productDistribution = query(EntityType.ProductDistribution, {
  name: 'NUG_P_SEA',
});

const productDistributionDeliveryMethod = create(
  EntityType.ProductDistributionDeliveryMethod,
  {
    productDistributionId: extract(productDistribution),
    deliveryMethodId: extract(deliveryMethod),
  }
);
```

With `extract` parameter:

```typescript
import { query, create, extract } from 'data-provisioner';
import { EntityType } from 'ts-api-types';

const event = query(EntityType.Event, {
  id: 'b8e1f80b-1574-7064-4734-444f856eb3a5',
});

const manifestConfiguration = query(EntityType.ManifestConfiguration, {
  id: extract(event, e => e.attributes.manifestConfigurationId),
});
```

## CreateSpec

A helper function wrapped around the [`create`](#create) combinator. Allows the developer to encode required parameters into the signature of [`create`](#create).

Most API entities have quite a few fields which are _not_ required to create the entity. Using [`createSpec`](#createspec), developers can annotate the specific fields required to create the entity.

[`createSpec`](#createspec) returns a new function with the specified attributes encoded as required parameters _at the type level_. I.e. you'll get a compiler error if you don't pass all the required fields.

> Note that like [`create`](#create), [`createSpec`](#createspec) accepts an optional `resolver` function which can be used to encode specialized resolver logic.

Examples:

```typescript
const createDeliveryMethod = createSpec(EntityType.DeliveryMethod, [
  'name',
  'deliveryProcess',
]);

// This type-checks
const deliveryMethod = createDeliveryMethod({
  name: 'My Delivery Method',
  deliveryProcess: 'DIGITAL_IN_APP',
});

// Type error
const deliveryMethod = createDeliveryMethod({
  name: 'My Delivery Method',
});
```

## Environment Runtime

The environment runtime exists as a sort of adapter layer between expressions and the environment itself. It transforms expressions into API calls, and exposes an interface which allows developers to reference entities created by the runtime via their associated expressions.

- [`provision`](#provision)
- [`teardown`](#teardown)

#### Relevant types:

##### `Runtime`

```typescript
type Runtime = {
  get: <E extends EntityType>(expr: Expr<E>) => ES.TypeMap[E];
};
```

`get` returns the entity instance associated with a given expression.

## Provision

A function which accepts an array of expressions and returns a `Promise` containing either a [`Runtime`](#runtime) context or a tuple of `[Runtime, Error]` if an error occurred.

```typescript
const provision = (logger: ApiRequestLogger) => (
  args: Expr<any>[]
): Promise<Either<[Runtime, Error], Runtime>>
```

#### `ApiRequestLogger`

Note that [`provision`](#provision) is a curried function, with a first parameter of type `ApiRequestLogger`. This is a function the runtime will use to log API request activity. The framework provides two `ApiRequestLogger`s out of the box. Assuming all tests in your test suite will use the same logger, it's recommended that you partially apply this function with your desired logger somewhere in your test suite.

With `defaultApiLogger` (logs to `STDOUT` / `console`):

```typescript
// provisioner.ts

import { defaultApiLogger, provision } from 'data-provisioner';

export const provisioner = provision(defaultApiLogger);
```

With `devNullApiLogger` (swallows all output):

```typescript
// provisioner.ts

import { devNullApiLogger, provision } from 'data-provisioner';

export const provisioner = provision(devNullApiLogger);
```

Usage:

```typescript
// Later on in a test...

// my-test.ts
import { provisioner } from './provisioner';
```

#### Using `provision`:

> Note: This framework makes use of the [`fp-ts`](https://gcanti.github.io/fp-ts/) library. Specifically in this example, the [`provision`](#provision) function returns [`fp-ts`](https://gcanti.github.io/fp-ts/)'s [`Either`](https://gcanti.github.io/fp-ts/modules/Either.ts.html) type to bifurcate between error and success states. It's not a hard requirement to use this library to interact with the [`Either`](https://gcanti.github.io/fp-ts/modules/Either.ts.html) type, as it's just a TypeScript tagged union under the hood.

```typescript
import {
  query,
  create,
  extract,
  defaultApiLogger,
  provision,
  teardown,
  Runtime,
} from 'data-provisioner';
import { EntityType } from 'ts-api-types';
import { isLeft } from 'fp-ts/lib/Either';

const deliveryMethod = create(EntityType.DeliveryMethod, {
  name: 'My Delivery Method',
  deliveryProcess: 'DIGITAL_IN_APP',
});

const productDistribution = query(EntityType.ProductDistribution, {
  name: 'NUG_P_SEA',
});

const productDistributionDeliveryMethod = create(
  EntityType.ProductDistributionDeliveryMethod,
  {
    productDistributionId: extract(productDistribution),
    deliveryMethodId: extract(deliveryMethod),
  }
);

let runtime: Runtime;
// Assume some notion of a `setup` function as part of the test suite...
setup(async () => {
  // Note that `deliveryMethod` and `productDistribution` don't need to be
  // explicitly referenced, as they're referenced in the construction of
  // `productDistributionDeliveryMethod`.
  const result = await provision(defaultApiLogger)([
    productDistributionDeliveryMethod,
  ]);

  if (isLeft(result)) {
    const [runtime, error] = result.left;
    // Invert any changes already performed in the environment
    await teardown(defaultApiLogger)(runtime);
    // Fail the test
    throw error;
  }

  runtime = result.right;
});

// Later on on in the body of the test...
() => {
  // Instance of a ProductDistributionDeliveryMethod associated with the
  // given expression (`productDistributionDeliveryMethod`)
  const pdpm = runtime.get(productDistributionDeliveryMethod);
};

// Assume some notion of an `after` function as part of the test suite...
after(async () => {
  // Invert any changes performed on the environment
  await teardown(defaultApiLogger)(runtime);
});
```

An example of [`Either`](https://gcanti.github.io/fp-ts/modules/Either.ts.html) extraction without [`fp-ts`](https://gcanti.github.io/fp-ts/):

```typescript
const result = await provision(defaultApiLogger)([
  productDistributionDeliveryMethod,
]);

if (result._tag === 'Left') {
  const [runtime, error] = result.left;
  await teardown(defaultApiLogger)(runtime);
  throw error;
}

runtime = result.right;
```

> Note that the in the event of failure, [`runtime`](#runtime) will still contain the evaluation history up until failure, meaning that it can still be used to invert any changes that were already applied.

## Teardown

A function which accepts a term of type [`Runtime`](#runtime) (as created by a call to [`provision`](#provision)) and inverts any changes performed on the environment (through reading the associated [`Runtime`](#runtime)).

Like [`provision`](#provision), [`teardown`](#teardown) is a curried function which accepts an [`ApiRequestLogger`](#ApiRequestLogger) as its first parameter which will be used to log API request activity.

```typescript
const teardown = (logger: ApiRequestLogger) => (
  runtime: Runtime
): Promise<Either<NonEmptyArray<Error>, void>>
```

[`teardown`](#teardown) returns a `Promise` containing either an array of errors encountered during inversion of environment state or `void` upon success.

Example:

```typescript
const result = await provision(defaultApiLogger)([
  productDistributionDeliveryMethod,
]);

if (isLeft(result)) {
  const [runtime, error] = result.left;
  await teardown(defaultApiLogger)(runtime);
  throw error;
}

runtime = result.right;

// Do useful stuff with the `runtime`...
// ...

await teardown(defaultApiLogger)(runtime);
```

With error handling:

```typescript
const result = await teardown(defaultApiLogger)(runtime);
if (isLeft(result)) {
  console.error('Teardown failed:');
  result.left.forEach(console.error);

  return;
}

console.log('Teardown successful');
```

## Built-in Resolvers

[This repository ships with a set of built-in resolver functions](https://github.com/10eTechnology/data-provisioner/blob/master/src/util/Resolvers/index.ts) you may use if your `create` or `update` expression requires more complicated resolution logic.

- [`id`](#id)
- [`untilHasAttrs`](#untilHasAttrs)
- [`awaitTransaction`](#awaitTransaction)
- [`untilEntity`](#untilEntity)
- [`toResolver`](#toResolver)
- [`compose`](#compose)
- [`composeR`](#composeR)

##### Type signature of `resolver`

```typescript
type Resolver<E extends EntityType> = (
  entity: ES.TypeMap[E],
  transactionId: string
) => Promise<ES.TypeMap[E]>;
```

A `resolver` is a function which accepts two parameters (you are free to write your own in-line if you'd like!).

1. `entity` — The entity instance returned from evaluating the expression.
2. `transactionId` — The transaction-id sent along with the request used to create/update the entity.

The function must return a `Promise` which resolves with the given entity instance.

### [`id`](https://github.com/10eTechnology/data-provisioner/blob/master/src/util/Resolvers/index.ts#L10)

This is the default `resolver` function used in `update` and `create` expressions. It simply returns the entity returned from the evaluation of the expression.

##### Signature and implementation

```typescript
export const id = <E extends EntityType>(): Resolver<E> => e =>
  Promise.resolve(e);
```

### [`untilHasAttrs`](https://github.com/10eTechnology/data-provisioner/blob/master/src/util/Resolvers/index.ts#L13)

This resolver polls the API for the returned entity until the specified attributes are neither `null` nor `undefined`. Accepts an array of the entity type's attribute names.

##### Signature

```typescript
type untilHasAttrs = <
  E extends EntityType,
  F extends (keyof ES.TypeMap[E]['attributes'])[]
>(
  f: F
) => Resolver<E>;
```

##### Example

```typescript
import { create, Resolvers } from 'data-provisioner';
import { EntityType } from 'ts-api-types';

const { untilHasAttrs } = Resolvers;

const expr = create(
  EntityType.Event,
  {
    // ...
  },
  // Don't resolve until the `event` has the
  // following attributes.
  untilHasAttrs([
    'eventManifestId',
    'priceConfigurationId',
    'manifestCategorySetId',
  ])
);
```

### [`awaitTransaction`](https://github.com/10eTechnology/data-provisioner/blob/master/src/util/Resolvers/index.ts#L44)

This resolver monitors the pub/sub channel and resolves once it sees a message containing the transaction-id associated with the request used to create the entity. The transaction-id is automatically fed into this function from the evaluator — you won't need to provide this.

##### Signature

```typescript
type awaitTransaction = <E extends EntityType>(
  timeout = 30000,
  rejectOnTimeout = true
) => Resolver<E>;
```

This function accepts two optional parameters. `timeout` — which specifies the amount of time (in milliseconds) the resolver should wait for a message containing the transaction-id, and `rejectOnTimeout` — which indicates whether or not resolution should fail if a message containing the transaction-id was never seen.

### [`untilEntity`](https://github.com/10eTechnology/data-provisioner/blob/master/src/util/Resolvers/untilEntity.ts)

This resolver accepts a `predicate` function as a parameter, with which the developer can specify their own logic for indicating whether or not the entity should be considered resolved.

> The `untilHasAttrs` resolver [uses this function internally](https://github.com/10eTechnology/data-provisioner/blob/master/src/util/Resolvers/index.ts#L19).

##### Signature

```typescript
type untilEntity = <E extends EntityType>(
  pred: (e: ES.TypeMap[E]) => boolean
) => Resolver<E>;
```

##### Example

```typescript
import { create, Resolvers } from 'data-provisioner';
import { EntityType } from 'ts-api-types';

const { untilEntity } = Resolvers;

const expr = create(
  EntityType.Event,
  {
    // ...
  },
  // Don't resolve until the `event` has
  // an `eventManifestId`.
  untilEntity(e => e.attributes.eventManifestId !== null)
);
```

### [`toResolver`](https://github.com/10eTechnology/data-provisioner/blob/master/src/util/Resolvers/index.ts#L27)

A utlity for transforming any asynchronous operation into a valid `resolver`. It's unlikely you'll need this unless your resolution logic involves polling other unreleated entities or services.

##### Signature

```typescript
type toResolver = <E extends EntityType>(
  effect: (e: ES.TypeMap[E]) => Promise<any>
) => Resolver<E>;
```

##### Example

```typescript
import rivalApiSdkJs from 'rival-api-sdk-js';
import { create, Resolvers, Poll } from 'data-provisioner';
import { EntityType } from 'ts-api-types';

const { toResolver } = Resolvers;
const { pollUntilNotEmpty } = Poll;

const expr = create(
  EntityType.Event,
  {
    // ...
  },
  // Here we create an asynchronous function which:
  // 1. Extracts the entitlement_base from the created event.
  // 2. Continuously queries for seat_groups using the event and
  //    the entitlement_base until results arrive.
  toResolver(async event => {
    const entitlementBase = (
      await rivalApiSdkJs
        .instance()
        .entityClient('entitlementBase')
        .list({
          entitlementType: 'SEATING',
          primary: true,
          eventManifestId: event.attributes.eventManifestId,
        })
    )[0];

    // `pollUntilNotEmpty` is a utility that periodically sends
    // an API query until that query returns at least one result.
    //
    // The return type of `pollUntilNotEmpty` here is a non-empty
    // array of seat_groups, which does not match the signature
    // of `resolver` — an `event` resolver _must_ return the
    // `event` instance. `toResolver` gets us around this by
    // implicitly feeding the `event` entity back into the
    // data-provisioner.
    //
    // We could have optionally added an `await` to this call
    // and returned the `event` instance that was injected at the
    // top of this function — the type signature would indeed
    // match up in that case and we would not need `toResolver`.
    // `toResolver` just gives you the flexibility to not need
    // to worry about returning the event from your asynchronous
    // operation. This is especially useful when chaining
    // promises and using the short arrow's implicit return
    // semantics (which we did not do here).
    return pollUntilNotEmpty(EntityType.SeatGroup, {
      queryType: 'MANAGE',
      type: 'ROW',
      entitlementBaseId: entitlementBase.id,
      eventId: event.id,
    });
  })
);
```

Note the signature of `resolver`. It _must_ return the entity back to the data-provisioner (note the return type).

```typescript
type Resolver<E extends EntityType> = (
  entity: ES.TypeMap[E],
  transactionId: string
) => Promise<ES.TypeMap[E]>;
```

Using `toResolver` ensures that regardless of the value returned from the given promise, the original entity will always be given back to the data-provisioner.

```typescript
type toResolver = <E extends EntityType>(
  effect: (e: ES.TypeMap[E]) => Promise<any>
) => Resolver<E>;
```

### [`compose`](https://github.com/10eTechnology/data-provisioner/blob/master/src/util/Resolvers/index.ts#L32)

A utlity for sequentially executing two `resolvers` (right-to-left), and feeding the output of one into the input of the other.

##### Signature

```typescript
type compose = <E extends EntityType>(
  a: Resolver<E>,
  b: Resolver<E>
) => Resolver<E>;
```

### [`composeR`](https://github.com/10eTechnology/data-provisioner/blob/master/src/util/Resolvers/index.ts#L39)

The same as [`compose`](#compose), but arguments are evaluated left-to-right.

##### Signature

```typescript
type composeR = <E extends EntityType>(
  a: Resolver<E>,
  b: Resolver<E>
) => Resolver<E>;
```

##### Example

```typescript
import { create, Resolvers, Poll } from 'data-provisioner';
import { EntityType } from 'ts-api-types';

const { composeR, untilHasAttrs, toResolver } = Resolvers;
const { pollUntilNotEmpty } = Poll;

const expr = create(
  EntityType.Event,
  {
    // ...
  },
  composeR(
    untilHasAttrs([
      'eventManifestId',
      'priceConfigurationId',
      'manifestCategorySetId',
    ]),
    // Don't execute the following resolver until the event has
    // `eventManifestId`, `priceConfigurationId`, and
    // `manifestCategorySetId`.
    toResolver(async event => {
      const entitlementBase = (
        await rivalApiSdkJs
          .instance()
          .entityClient('entitlementBase')
          .list({
            entitlementType: 'SEATING',
            primary: true,
            // We've protected against `eventManifestId` not
            // being set by chaining this with the above
            // `untilHasAttrs`.
            eventManifestId: event.attributes.eventManifestId,
          })
      )[0];

      return pollUntilNotEmpty(EntityType.SeatGroup, {
        queryType: 'MANAGE',
        type: 'ROW',
        entitlementBaseId: entitlementBase.id,
        eventId: event.id,
      });
    })
  )
);
```

## Baking in resolution logic to expressions with [`createSpec`](#createSpec)

Above, we briefly mentioned [`createSpec`](#createSpec). [`createSpec`](#createSpec) is a function which returns a function which creates an expression with embedded field and resolution semantics — you can think of it as an expression factory factory.

```typescript
import { createSpec, Resolvers, Poll, Fetch } from 'data-provisioner';
import { EntityType } from 'ts-api-types';

const { untilHasAttrs, toResolver, composeR } = Resolvers;
const { first } = Fetch;
const { pollUntilNotEmpty } = Poll;

export const createEvent = createSpec(
  EntityType.Event,
  ['manifestConfigurationTemplateId', 'name', 'eventDatetime'],
  composeR(
    untilHasAttrs([
      'eventManifestId',
      'priceConfigurationId',
      'manifestCategorySetId',
    ]),
    toResolver(event =>
      first(EntityType.EntitlementBase)({
        entitlementType: 'SEATING',
        primary: true,
        eventManifestId: event.attributes.eventManifestId,
      }).then(entitlementBase =>
        pollUntilNotEmpty(EntityType.SeatGroup, {
          queryType: 'MANAGE',
          type: 'ROW',
          entitlementBaseId: entitlementBase.id,
          eventId: event.id,
        })
      )
    )
  )
);
```

We now have a function called `createEvent` which, when called, creates a new `event` expression which implicitly has the given resolution logic baked into it. This is a really powerful way write resolution semantics once for a single entity type, and re-use it for every other instance of an expression of that type.

Creating an event with this resolution logic is now as simple as

```typescript
// Assume some `venue` expr above
const manifestConfigurationTemplate = query(
  EntityType.ManifestConfigurationTemplate,
  { venueId: extract(venue) }
);

// This event expression has all the above defined resolution
// logic baked into it.
const eventExpr = createEvent({
  manifestConfigurationTemplateId: extract(manifestConfigurationTemplate),
  name: `My Event`,
  eventDatetime: {
    timezone: extract(venue, v => v.attributes.timezone),
    datetimeUtc: moment(faker.date.future()).toISOString(),
  },
  }
});
```

## Creating non-inlined `resolvers`

All the `resolvers` we've created thus far were added inline during the creation of our expressions. This provides the benefit of type-inference — TypeScript can automatically infer the type of the resolver by virtue of its explicit embedding into an already typed expression. All expressions are immediately 'reified' once its `EntityType` parameter is specified (this is how — TypeScript is able to type check the attribute parameters).

```typescript
// This expression is reified to type `EntityType.Event` the moment the `EntityType.Event` parameter is specified.
const expr = create(
  EntityType.Event,
  {
    //...
  },
  // As such, typescript automatically knows the entity below
  // _must_ be of type `event`.
  event => {
    // ...
  }
);
```

But what if we want to create a resolver that isn't embedded in an expression? We can do this by explicitly declaring the type of a resolver when creating it.

```typescript
import { EntityType } from 'ts-api-types';
import { Resolvers } from 'data-provisioner';

const { Resolver } = Resolvers;

const myResolver: Resolver<EntityType.Event> = event => {
  // Do something more interesting that this...
  return Promise.resolve(event);
};

const expr = create(
  EntityType.Event,
  {
    //...
  },
  myResolver
);
```
