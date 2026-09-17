import { F } from "k-ts-framework";

/**
 * 动态数组契约，逐一对齐 packages/k-ts-protobuf/src/Engine.ts 的 TArray。
 * （k-ts-framework-cocos 不依赖 k-ts-protobuf，此处本地复刻同一形状。）
 */
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

class ByteArray implements TArray<number> {
    private data: number[] = [];

    public Num(): number {
        return this.data.length;
    }

    public Add(Value: number): void {
        this.data.push(Value);
    }

    public Get(Index: number): number {
        F.assert(this.IsValidIndex(Index), `byte array get index out of range: ${Index}`);
        return this.data[Index] as number;
    }

    public GetRef(Index: number): number {
        return this.Get(Index);
    }

    public Set(Index: number, Value: number): void {
        F.assert(this.IsValidIndex(Index), `byte array set index out of range: ${Index}`);
        this.data[Index] = Value;
    }

    public Contains(Value: number): boolean {
        return this.data.includes(Value);
    }

    public FindIndex(Value: number): number {
        return this.data.indexOf(Value);
    }

    public RemoveAt(Index: number): void {
        F.assert(this.IsValidIndex(Index), `byte array remove index out of range: ${Index}`);
        this.data.splice(Index, 1);
    }

    public IsValidIndex(Index: number): boolean {
        return Number.isInteger(Index) && Index >= 0 && Index < this.data.length;
    }

    public Empty(): void {
        this.data.length = 0;
    }
}

/** 创建一个字节数组（F.Engine.NewByteArray 的 cc 实现） */
export function newByteArray(): TArray<number> {
    return new ByteArray();
}

declare module "k-ts-framework" {
    export namespace F {
        export namespace Engine {
            export function NewByteArray(): TArray<number>;
        }
    }
}
