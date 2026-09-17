/* eslint-disable @typescript-eslint/method-signature-style */
export interface TArray<T> {
    Num(): number;
    Add(Value: T): void;
    Get(Index: number): T;
    GetRef(Index: number): T;
    Set(Index: number, Value: T): void;
    Contains(Value: T): boolean;
    FindIndex(Value: T): number;
    RemoveAt(Index: number): void;
    IsValidIndex(Index: number): boolean;
    Empty(): void;
}

declare module "k-ts-framework" {
    export namespace F {
        export namespace Engine {
            export function NewByteArray(): TArray<number>;
        }
    }
}
