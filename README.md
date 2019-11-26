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

An `enum` enumerating all available entity types from the Rival APIs. [Defined in the SDK](https://github.com/10eTechnology/rival-api-sdk-js/blob/master/src/types/EntityType.ts#L12)

Example:

```typescript
import { EntityType } from 'rival-api-sdk-js';

type Event = EntityType.Event;
```

##### `ES.TypeMap`:

A type constructor which returns an `EntityType`'s associated schema. [Defined in the SDK](https://github.com/10eTechnology/rival-api-sdk-js/blob/master/src/types/EntitySchemas.ts)

Example:

```typescript
import { EntityType, EntitySchemas as ES } from 'rival-api-sdk-js';

type EventSchema = ES.TypeMap[EntityType.Event];
```

##### `AttrRecurse`:

A type constructor which returns a type denoting all available fields for a particular `EntityType`. Field values _can_ be a reference to another expression (using the `extract` combinator).

```typescript
import { EntityType, EntitySchemas as ES } from 'rival-api-sdk-js';

type Attr<E extends EntityType> = ES.TypeMap[E]['attributes'];

type AttrRecurse<E extends EntityType> = {
  [K in Attr<E>]: ExprExtractor<any> | Attr<E>[K];
};
```

Where `ExprExtractor` denotes any nested `extract` calls.

##### `Expr`:

A type constructor which returns expression combinator parameterized by an `EntityType`.

## Create

A function used to indicate that an entity should be created with a given set of attributes. Accepts an optional `resolver` parameter which can be used to encode custom resolution logic.

```typescript
function create<E extends EntityType>(
  entityType: E,
  fields: AttrRecurse<E>,
  resolver?: (entity: ES.TypeMap[E]) => Promise<ES.TypeMap[E]>
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
import { EntityType } from 'rival-api-sdk-js';

const productDistribution = query(EntityType.ProductDistribution, {
  name: 'NUG_P_SEA',
});
```

With `picker`:

```typescript
import { query } from 'data-provisioner';
import { EntityType } from 'rival-api-sdk-js';

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
import { EntityType } from 'rival-api-sdk-js';

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
import { EntityType } from 'rival-api-sdk-js';

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
import { EntityType } from 'rival-api-sdk-js';
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
