import { TArray } from "./Engine";

export type Constructor<T = {}> = new (...args: any[]) => T;

export const PROTOBUF_SYSTEM_TAG = "Protobuf";
export const DEFAULT_PB_PACKAGE_NAME = "_DEFAULT_PB_PACKAGE";

export enum ValueType {
    Double = "double",
    Float = "float",
    Int32 = "int32",
    Int64 = "int64",
    UInt32 = "uint32",
    UInt64 = "uint64",
    SInt32 = "sint32",
    SInt64 = "sint64",
    Fixed32 = "fixed32",
    Fixed64 = "fixed64",
    SFixed32 = "sfixed32",
    SFixed64 = "sfixed64",
    Bool = "bool",
    String = "string",
    Bytes = "bytes",
}

export enum RuleType {
    // proto3 默认是optional，required也不用了
    optional = "optional",
    // required = "required",
    repeated = "repeated",
}

/**
 * encode或者decode时包头用什么形式进行存储
 */
export enum HeaderType {
    None = 0, // 纯buffer，不存包头
    Id, // 最大65535
    Name, // 最长65535
}

export type Double = number;
export type Float = number;
export type Int32 = number;
export type Int64 = number;
export type Uint32 = number;
export type Uint64 = number;
export type SInt32 = number;
export type SInt64 = number;
export type Fixed32 = number;
export type Fixed64 = number;
export type SFixed32 = number;
export type SFixed64 = number;
export type Bool = boolean;
export type String = string;
export type Bytes = Array<number>;
export type PBMap<TKey, TValue> = Map<TKey, TValue>;
export type PBMessage<T> = T;
export type PBArray<T> = Array<T>;

export type EngineBuffer = TArray<number>;

export let MESSAGE_COVERT_OPTIONS = {
    longs: Number,
    enums: Number,
    bytes: Uint8Array,
    oneofs: true,
    arrays: true,
    objects: true,
    defaults: true,
    useBigIntInsteadOfLong: false,
    convertPBMapToJSMap: false,
};