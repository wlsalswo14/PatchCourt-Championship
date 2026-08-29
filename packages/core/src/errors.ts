export class ContractError extends Error {
  override readonly name = "ContractError";
}

export class LifecycleError extends Error {
  override readonly name = "LifecycleError";
}

export class NotFoundError extends Error {
  override readonly name = "NotFoundError";
}

export class CancellationError extends Error {
  override readonly name = "CancellationError";
}
