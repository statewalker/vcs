export type DeltaRange =
  | { from: "source"; start: number; len: number }
  | { from: "target"; start: number; len: number };

export type Delta =
  | {
      type: "start";
      targetLen: number;
    }
  | {
      type: "copy";
      start: number;
      len: number;
    }
  | {
      type: "insert";
      data: Uint8Array;
    }
  | {
      type: "finish";
      checksum: number;
    };
