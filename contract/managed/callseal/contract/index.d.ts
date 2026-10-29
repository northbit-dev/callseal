import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum Direction { ABOVE = 0, BELOW = 1 }

export enum CallStatus { SEALED = 0, HIT = 1, MISS = 2 }

export type CallOpening = { asset: bigint;
                            direction: Direction;
                            level: bigint;
                            salt: Uint8Array
                          };

export type CallRecord = { analyst: Uint8Array;
                           commitment: Uint8Array;
                           sealedRound: bigint;
                           expiryRound: bigint;
                           status: CallStatus
                         };

export type Stats = { calls: bigint; hits: bigint; misses: bigint };

export type RevealedCall = { asset: bigint; direction: Direction; level: bigint
                           };

export type Witnesses<PS> = {
  localSecretKey(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  pendingCall(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, CallOpening];
  storedOpening(context: __compactRuntime.WitnessContext<Ledger, PS>,
                id_0: bigint): [PS, CallOpening];
}

export type ImpureCircuits<PS> = {
  publishCloses(context: __compactRuntime.CircuitContext<PS>, prices_0: bigint[]): __compactRuntime.CircuitResults<PS, bigint>;
  registerAnalyst(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  sealCall(context: __compactRuntime.CircuitContext<PS>, expiryRound_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  proveHit(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  expireCall(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revealCall(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): __compactRuntime.CircuitResults<PS, CallStatus>;
}

export type ProvableCircuits<PS> = {
  publishCloses(context: __compactRuntime.CircuitContext<PS>, prices_0: bigint[]): __compactRuntime.CircuitResults<PS, bigint>;
  registerAnalyst(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  sealCall(context: __compactRuntime.CircuitContext<PS>, expiryRound_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  proveHit(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  expireCall(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revealCall(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): __compactRuntime.CircuitResults<PS, CallStatus>;
}

export type PureCircuits = {
  publicKey(sk_0: Uint8Array): Uint8Array;
  commitmentOf(author_0: Uint8Array, c_0: CallOpening): Uint8Array;
  isHit(c_0: CallOpening, close_0: bigint): boolean;
  isNonTrivial(c_0: CallOpening, ref_0: bigint, bps_0: bigint): boolean;
}

export type Circuits<PS> = {
  publicKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  commitmentOf(context: __compactRuntime.CircuitContext<PS>,
               author_0: Uint8Array,
               c_0: CallOpening): __compactRuntime.CircuitResults<PS, Uint8Array>;
  isHit(context: __compactRuntime.CircuitContext<PS>,
        c_0: CallOpening,
        close_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  isNonTrivial(context: __compactRuntime.CircuitContext<PS>,
               c_0: CallOpening,
               ref_0: bigint,
               bps_0: bigint): __compactRuntime.CircuitResults<PS, boolean>;
  publishCloses(context: __compactRuntime.CircuitContext<PS>, prices_0: bigint[]): __compactRuntime.CircuitResults<PS, bigint>;
  registerAnalyst(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  sealCall(context: __compactRuntime.CircuitContext<PS>, expiryRound_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  proveHit(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  expireCall(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  revealCall(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): __compactRuntime.CircuitResults<PS, CallStatus>;
}

export type Ledger = {
  readonly oracle: Uint8Array;
  readonly minMoveBps: bigint;
  readonly graceRounds: bigint;
  readonly round: bigint;
  closes: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): bigint[];
    [Symbol.iterator](): Iterator<[bigint, bigint[]]>
  };
  readonly nextId: bigint;
  calls: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): CallRecord;
    [Symbol.iterator](): Iterator<[bigint, CallRecord]>
  };
  analysts: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Stats;
    [Symbol.iterator](): Iterator<[Uint8Array, Stats]>
  };
  revealed: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): RevealedCall;
    [Symbol.iterator](): Iterator<[bigint, RevealedCall]>
  };
  readonly totalSealed: bigint;
  readonly totalHits: bigint;
  readonly totalMisses: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               oraclePk_0: Uint8Array,
               moveBps_0: bigint,
               grace_0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
