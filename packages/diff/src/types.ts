export type DeltaRange =
  | { from: "source"; start: number; len: number }
  | { from: "target"; start: number; len: number };

export type Delta =
  | {
      start: number;
      len: number;
    }
  | {
      data: Uint8Array;
    };
