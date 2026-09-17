import { Decimal } from "decimal.js";

import { getGlobalConfig } from "../data/Define";
import { assertWithLoc, newLocError } from "../misc/Localization";
import { assert } from "../misc/Util";
import { Serializer } from "./Base";

import type { IArraySerializeConfig, IMapSerializeConfig, INumberSerializeConfig, IObjectSerializeConfig, IOneOfSerializeConfig, ISerializeConfig, SerializeType } from "./Base";
export class StringReader extends Serializer {
    public isReader() {
        return true;
    }

    public convertBoolean(v: any) {
        if (typeof v === "string") return !(v.toLowerCase() === "false" || v === "0");
        else return Boolean(v);
    }

    public convertNumber(v: any, precision?: number) {
        let ret = Number(v);
        if (Number.isInteger(ret)) return ret;

        assert(Number.isFinite(ret) && !Number.isNaN(ret), `invalid-number-value ${v}`);
        return parseFloat(new Decimal(v).toFixed(precision !== undefined ? Number(precision) : getGlobalConfig().floatPrecision));
    }

    public serialize<T extends SerializeType>(v: T | undefined, defaultValue: T, config: ISerializeConfig): T {
        if (this.data === undefined) {
            if (config.required) throw newLocError("string-reader-read-failed-with-invalid-data");
            else return config.optional ? (undefined as T) : defaultValue;
        }
        // if (data === undefined) throw new Error("StringReader data is invalid");
        // let data = String(this.data);
        let data = this.data;
        if (typeof data !== "string") {
            return data as T;
        }
        if (data.length === 0) {
            if (config.required) throw newLocError("string-reader-read-failed-with-invalid-data");
            else return config.optional ? (undefined as T) : defaultValue;
        }

        if (defaultValue === null) {
            return null as T;
        } else if (defaultValue === undefined) {
            return undefined as T;
        } else {
            let type = typeof defaultValue;
            switch (type) {
                case "string":
                    return data as T;
                case "number":
                    return this.convertNumber(data, (config as INumberSerializeConfig).precision) as T;
                case "bigint":
                    return BigInt(data) as T;
                case "boolean":
                    return this.convertBoolean(data) as T;
            }
        }

        assertWithLoc(false, "invalid-value-type-in-string-reader", {
            name: config.name,
            type: typeof defaultValue,
        });
    }

    public serializeArray<T>(_: Array<T> | undefined, defaultValue: Array<T>, config: IArraySerializeConfig, forElement: (sr: Serializer, element: T) => T) {
        if (this.data === undefined || (typeof this.data === "string" && this.data.length === 0)) {
            if (config?.required) throw newLocError("string-reader-read-failed-with-invalid-data");
            else return config?.optional ? (undefined as any) : defaultValue;
        }

        let array;
        if (Array.isArray(this.data)) {
            array = this.data;
        } else {
            let data = String(this.data).trim();
            if (data.length === 0) {
                array = [];
            } else {
                let separator = config?.separator ?? getGlobalConfig().stringArraySeparator;
                if (data.endsWith(separator)) data = data.substring(0, data.length - 1);
                array = data.split(separator);
            }
        }
        if (array.length === 0 && config?.optional) return undefined;

        let result = new Array<T>();
        let tempData = this.data;

        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < array.length; ++i) {
            this.data = array[i];
            result.push(forElement(this, array[i] as unknown as T));
        }
        this.data = tempData;
        return result;
    }

    public serializeMap<TKey, TValue>(
        _: Map<TKey, TValue> | undefined,
        defaultValue: Map<TKey, TValue>,
        config: IMapSerializeConfig,
        forKey: (sr: Serializer, key: TKey) => TKey,
        forValue: (sr: Serializer, value: TValue) => TValue,
    ) {
        if (this.data === undefined || (typeof this.data === "string" && this.data.length === 0)) {
            if (config.required) throw newLocError("string-reader-read-failed-with-invalid-data");
            else return config?.optional ? (undefined as any) : defaultValue;
        }
        let array;
        if (Array.isArray(this.data)) {
            // 是Array<Array<any>>类型，是内部Array元素必须是2个，模仿Map的Array构造函数
            array = this.data;
        } else {
            let data = String(this.data).trim();
            if (data.length === 0) {
                array = [];
            } else {
                let eSeparator = config?.elementSeparator ?? getGlobalConfig().stringMapElementSeparator;
                if (data.endsWith(eSeparator)) data = data.substring(0, data.length - 1);
                array = data.split(eSeparator);
            }
        }
        if (array.length === 0 && config?.optional) return undefined;

        let kvSeparator = config?.keyValueSeparator ?? getGlobalConfig().stringMapKeyValueSeparator;
        let result = new Array<any>();
        let tempData = this.data;
        let kvRaw;
        let kv;
        let v;

        // eslint-disable-next-line @typescript-eslint/prefer-for-of
        for (let i = 0; i < array.length; ++i) {
            v = array[i];
            if (Array.isArray(v)) {
                kv = v;
            } else {
                kvRaw = v.trim();
                if (kvRaw.length === 0) continue;
                kv = kvRaw.split(kvSeparator);
            }
            assertWithLoc(kv.length === 2, "invalid-map-element", { name: config.name, data: v });

            this.data = kv[0];
            let key = forKey(this, this.data! as unknown as TKey);
            this.data = kv[1];
            let value = forValue(this, this.data! as unknown as TValue);

            assertWithLoc(!result.find((v) => v[0] === key), "duplicate-map-key", { name: config.name, key: key });
            result.push([key, value]);
        }
        this.data = tempData;
        return new Map<TKey, TValue>(result);
    }

    public serializeStruct(
        _: object,
        defaultValue: object,
        config: IObjectSerializeConfig,
        forKey: (sr: Serializer, name: string | number, value: unknown) => string,
        forValue: (sr: Serializer, key: string, value: unknown) => unknown,
    ) {
        if (this.data === undefined || (typeof this.data === "string" && this.data.length === 0)) {
            if (config.required) throw newLocError("string-reader-read-failed-with-invalid-data");
            else return config?.optional ? (undefined as any) : defaultValue;
        }

        let array;
        if (Array.isArray(this.data)) {
            // 和Map相同，是Array<Array<any>>类型，不同的是内部Array元素可以是1个或者2个，1个则按数组解
            array = this.data;
        } else {
            let data = String(this.data).trim();
            if (data.length === 0) {
                array = [];
            } else {
                let eSeparator = config?.elementSeparator ?? getGlobalConfig().stringObjElementSeparator;
                if (data.endsWith(eSeparator)) data = data.substring(0, data.length - 1);
                array = data.split(eSeparator);
            }
        }
        if (array.length === 0 && config.optional) return undefined;

        let nvSeparator = config.nameValueSeparator ?? getGlobalConfig().stringObjNameValueSeparator;
        let tempData = this.data;
        let result = {} as any;
        let nvRaw;
        let nameOrIndex;
        let v;
        let nv;

        for (let i = 0; i < array.length; ++i) {
            v = array[i];
            if (Array.isArray(v)) {
                nv = v;
            } else {
                nvRaw = v.trim();
                if (nvRaw.length === 0) continue;
                nv = nvRaw.split(nvSeparator);
            }

            // assertWithLoc(nv.length === 2, "invalid-object-element", { name: config.name, data: v });
            if (nv.length === 2) {
                nameOrIndex = nv[0];
                this.data = nv[1];
            } else {
                nameOrIndex = i;
                this.data = v;
            }

            let key = forKey(this, nameOrIndex, this.data!);
            let ret = forValue(this, key, this.data!);
            assertWithLoc(result[key] === undefined, `duplicate-object-key`, { name: config.name, key: key });
            if (ret !== undefined) result[key] = ret;
        }
        this.data = tempData;
        return result;
    }

    public serializeOneOf(
        _: object,
        defaultValue: object,
        config: IOneOfSerializeConfig,
        forTypeKey: (sr: Serializer, value: unknown) => string,
        forTypeValue: (sr: Serializer, typeKey: string, value: unknown) => string,
        forKey: (sr: Serializer, typeValue: string, value: unknown) => string,
        forValue: (sr: Serializer, key: string, value: unknown) => unknown,
    ) {
        if (this.data === undefined) {
            if (config.required) throw newLocError("string-reader-read-failed-with-invalid-data");
            else return config?.optional ? (undefined as any) : defaultValue;
        }

        let array;
        if (Array.isArray(this.data)) {
            // 只有俩元素
            array = this.data;
        } else {
            let data = String(this.data).trim();
            if (data.length === 0) {
                array = [];
            } else {
                let separator = config?.separator ?? getGlobalConfig().stringOneOfKeySeparator;
                array = data.split(separator);
            }
        }
        if (array.length === 0 && config.optional) return undefined;
        assertWithLoc(array.length === 2, "invalid-oneof-data", { name: config.name, data: this.data });

        let result = {} as any;
        let tempData = this.data;
        this.data = array[0];
        let typeKey = forTypeKey(this, this.data);
        let typeValue = forTypeValue(this, typeKey, this.data);
        result[typeKey] = typeValue;

        this.data = array[1];
        let key = forKey(this, typeValue, this.data);
        let value = forValue(this, key, this.data);
        result[key] = value;

        this.data = tempData;
        return result;
    }
}

// ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// export class StringWriter extends Serializer {
//     public constructor() {
//         super();
//         this.data = "";
//     }

//     public isReader() {
//         return false;
//     }

//     public serialize<T extends SerializeType>(v: T | undefined, defaultValue: T, config: ISerializeConfig): T {
//         if (defaultValue === null) {
//             this.data = "null";
//             return v as T;
//         } else if (defaultValue === undefined) {
//             this.data = "";
//             return v as T;
//         } else {
//             let type = typeof defaultValue;
//             switch (type) {
//                 case "string":
//                 case "number":
//                 case "bigint":
//                 case "boolean":
//                     this.data = String(v);
//                     return v!;
//             }
//         }

//         assertWithLoc(false, "invalid-value-type-in-string-writer", {
//             name: config.name,
//             type: typeof defaultValue,
//         });
//     }

//     public serializeArray<T>(
//         array: Array<T> | undefined,
//         defaultValue: Array<T>,
//         config: IArraySerializeConfig,
//         forElement: (s: Serializer, element: T) => T,
//     ) {
//         if (array === undefined) {
//             this.data = "";
//             if (!defaultValue) return array as unknown as Array<T>;
//             else array = defaultValue;
//         }

//         let data = this.getData<string>();
//         let tempData: string;
//         let separator = config.separator ?? getGlobalConfig().stringArraySeparator;
//         for (let i = 0; i < array.length; ++i) {
//             tempData = data;
//             forElement(this, array[i]);
//             this.data = tempData + data + (i !== array.length - 1 ? separator : "");
//         }

//         return array;
//     }

//     public serializeMap<TKey, TValue>(
//         map: Map<TKey, TValue> | undefined,
//         defaultValue: Map<TKey, TValue>,
//         config: IMapSerializeConfig,
//         forKey: (s: Serializer, k: TKey) => TKey,
//         forValue: (s: Serializer, v: TValue) => TValue,
//     ) {
//         if (map === undefined) {
//             this.data = "";
//             if (!defaultValue) return map as unknown as Map<TKey, TValue>;
//             else map = defaultValue;
//         }

//         let eSeparator = config.elementSeparator ?? getGlobalConfig().stringMapElementSeparator;
//         let kvSeparator = config.keyValueSeparator ?? getGlobalConfig().stringMapKeyValueSeparator;
//         let array = Object.entries(map);
//         let data = this.getData<string>();
//         let tempData;

//         for (let i = 0; i < array.length; ++i) {
//             let [key, value] = array[i];
//             tempData = this.data;
//             forKey(this, key as TKey);
//             this.data = tempData + data;

//             tempData = this.data;
//             forValue(this, value);
//             this.data = tempData + kvSeparator + this.data;

//             this.data += i < array.length - 1 ? eSeparator : "";
//         }

//         return map;
//     }

//     public serializeObject(
//         obj: object,
//         defaultValue: object,
//         config: IObjectSerializeConfig,
//         forNameAndValue: (sr: Serializer, name: string | number, value: unknown) => IAliasAndValue | undefined,
//     ) {
//         if (obj === undefined) {
//             this.data = "";
//             if (!defaultValue) return obj;
//             else obj = defaultValue;
//         }

//         let eSeparator = config.elementSeparator ?? getGlobalConfig().stringObjElementSeparator;
//         let nvSeparator = config.nameValueSeparator ?? getGlobalConfig().stringObjNameValueSeparator;
//         let array = Object.entries(obj);

//         for (let i = 0; i < array.length; ++i) {
//             let [name, value] = array[i];
//             forNameAndValue(this, name, value);
//             this.data = name + nvSeparator + this.data;
//             this.data += i < array.length - 1 ? eSeparator : "";
//         }

//         return obj;
//     }

//     public serializeOneOf(
//         obj: object,
//         defaultValue: object,
//         config: IOneOfSerializeConfig,
//         forKey: (sr: Serializer, name: string | number, key: unknown) => IAliasAndValue,
//         forValue: (sr: Serializer, name: string | number, value: unknown) => IAliasAndValue | undefined,
//     ) {
//         if (obj === undefined) {
//             this.data = "";
//             if (!defaultValue) return obj;
//             else obj = defaultValue;
//         }

//         let separator = config.separator ?? getGlobalConfig().stringOneOfKeySeparator;
//         let array = Object.entries(obj);
//         assertWithLoc(array.length > 0 && array.length <= 2, "invalid-oneof-input-object", { name: config.name });

//         let ret = obj as any;
//         let keyName = config.keyName ?? getGlobalConfig().stringOneOfKeySeparator;
//         let valueName = ret[keyName];

//         if (valueName === undefined) {
//             for (let [k, name] of config.keyValueToName) {
//                 if (ret[k as string] !== undefined) {
//                     valueName = name;
//                     break;
//                 }
//             }
//         }
//         assertWithLoc(valueName !== undefined, "can-not-find-oneof-key-from-input-object", { name: config.name });

//         let data = this.getData<string>();
//         forKey(this, keyName, valueName);
//         this.data = data + this.data;

//         data = this.data as string;
//         forValue(this, valueName, ret[valueName]);
//         this.data = data + separator + this.data;

//         return ret;
//     }
// }
