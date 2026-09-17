/* eslint-disable @typescript-eslint/member-ordering */
export type SerializeType = number | string | boolean | null | undefined | bigint;

export interface ISerializeConfig {
    name: string;
    default?: string | number;
    optional?: boolean;
    required?: boolean;
}

export interface INumberSerializeConfig extends ISerializeConfig {
    precision?: number;
}

export interface IArraySerializeConfig extends ISerializeConfig {
    separator?: string;
}

export interface IMapSerializeConfig extends ISerializeConfig {
    elementSeparator?: string;
    keyValueSeparator?: string;
}

export interface IObjectSerializeConfig extends ISerializeConfig {
    elementSeparator?: string;
    nameValueSeparator?: string;
}

export interface IOneOfSerializeConfig extends ISerializeConfig {
    separator?: string;
}

export abstract class Serializer {
    public abstract isReader(): boolean;
    public abstract serialize<T extends SerializeType | undefined>(v: T, defaultValue: T, config: ISerializeConfig): T;
    public abstract serializeArray<T>(
        v: Array<T> | undefined,
        defaultValue: Array<T> | undefined,
        config: IArraySerializeConfig,
        forElement: (sr: Serializer, element: T) => T
    ): Array<T>;
    public abstract serializeMap<TKey, TValue>(
        v: Map<TKey, TValue> | undefined,
        defaultValue: Map<TKey, TValue> | undefined,
        config: IMapSerializeConfig,
        forKey: (sr: Serializer, key: TKey) => TKey,
        forValue: (sr: Serializer, value: TValue) => TValue
    ): Map<TKey, TValue>;
    public abstract serializeStruct(
        v: object,
        defaultValue: object | undefined,
        config: IObjectSerializeConfig,
        forKey: (sr: Serializer, name: string | number, value: unknown) => string,
        forValue: (sr: Serializer, key: string, value: unknown) => unknown
    ): unknown;
    public abstract serializeOneOf(
        v: object,
        defaultValue: object | undefined,
        config: IOneOfSerializeConfig,
        forTypeKey: (sr: Serializer, value: unknown) => string,
        forTypeValue: (sr: Serializer, typeKey: string, value: unknown) => string,
        forKey: (sr: Serializer, typeValue: string, value: unknown) => string,
        forValue: (sr: Serializer, key: string, value: unknown) => unknown
    ): unknown;

    protected data: unknown;

    public setData(data: unknown) {
        this.data = data;
    }
    public getData<T>() {
        return this.data as T;
    }
    public serializeNumber(v: number | undefined, config: ISerializeConfig, defaultValue?: number) {
        return this.serialize(v, defaultValue ?? 0, config);
    }
    public serializeBigInt(v: bigint | undefined, config: ISerializeConfig, defaultValue?: bigint) {
        return this.serialize(v, defaultValue ?? 0n, config);
    }
    public serializeString(v: string | undefined, config: ISerializeConfig, defaultValue?: string) {
        return this.serialize(v, defaultValue ?? "", config);
    }
    public serializeBoolean(v: boolean | undefined, config: ISerializeConfig, defaultValue?: boolean) {
        return this.serialize(v, defaultValue ?? false, config);
    }
    public serializeNull(_1: null | undefined, config: ISerializeConfig, _2?: null) {
        return this.serialize(null, null, config);
    }
    public serializeUndefined(_1: undefined, config: ISerializeConfig, _2?: undefined) {
        return this.serialize(undefined, undefined, config);
    }
}
