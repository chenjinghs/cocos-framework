import { getGlobalConfig } from "../data/Define";
import type { Field } from "../field/Base";
import { ContainerField, SerializeContext } from "../field/Base";
import type { MapField, OneOfField, StructField } from "../field/Field";
import type { IArraySerializeConfig, IMapSerializeConfig, IObjectSerializeConfig, IOneOfSerializeConfig, ISerializeConfig, SerializeType } from "../serializer/Base";
import { Serializer } from "../serializer/Base";
import { assert } from "./Util";

export class RawDataPreProcessHelper {
    public ps = new Array<RawDataPreProcess>();

    public static create(fields: Array<Field>) {
        let ret = new RawDataPreProcessHelper();
        ret.tryCreateCombinePreProcess(fields);
        return ret;
    }

    public processKeys(rawKeys: string[]) {
        if (this.ps.length === 0) return rawKeys;

        for (let p of this.ps) {
            rawKeys = p.processKeys(rawKeys);
        }
        return rawKeys;
    }

    public processRawData(rawObj: any) {
        if (this.ps.length === 0) return rawObj;

        for (let p of this.ps) {
            rawObj = p.processRawData(rawObj);
        }
        return rawObj;
    }

    public getDebugInfo(context: SerializeContext) {
        let ret;
        for (let p of this.ps) {
            ret = p.getDebugInfo(context);
            if (ret) return ret;
        }
        return undefined;
    }

    private tryCreateCombinePreProcess(fields: Array<Field>) {
        if (!fields.find((f) => f.config?.combinable)) return;
        this.ps.push(new CombinePreProcess(fields));
    }
}

export interface IPreProcessDebugInfo {
    rawKey: string;
    rawIndex: number;
}

export abstract class RawDataPreProcess {
    public constructor(public allFields: Array<Field>) {}
    public generateMapping() {}
    public abstract processKeys(rawKeys: string[]): string[];
    public abstract processRawData(rawData: object): any;

    // 这个设计不太好，先凑合这么着吧
    public getDebugInfo(context: SerializeContext): IPreProcessDebugInfo | undefined {
        return undefined;
    }
}

// ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
export class CombineHelper extends Serializer {
    public rawKeyToIndex = new Map<string, number>();
    public rawObj!: any;
    public context!: SerializeContext;
    public combinableKey = "";
    public debugDescToRawKey = new Map<string, string>();
    public aliasToColumnKey = new Map<string, string>(); // 改列名用的

    public isReader(): boolean {
        return true;
    }

    public merge(field: Field, rawKeyToIndex: Map<string, number>, rawObj: any) {
        this.rawKeyToIndex = rawKeyToIndex;
        this.rawObj = rawObj;
        this.context = new SerializeContext();
        this.combinableKey = "";
        this.debugDescToRawKey.clear();

        return field.serializeValue(this, undefined as any, this.context);
    }

    public serialize<T extends SerializeType>(v: T | undefined, defaultValue: T, config: ISerializeConfig): T {
        let value = this.saveDataWithCombinableKey(this.context.currentField!);
        if (value !== undefined) return value;
        return config.optional || config.default === undefined ? (undefined as T) : defaultValue;
    }

    public serializeArray<T>(_: Array<T> | undefined, _defaultValue: Array<T>, _config: IArraySerializeConfig, forElement: (sr: Serializer, element: T) => T) {
        let field = this.context.currentField!;
        let found = this.verifyDataWithCombinableKey(field);
        if (found) return found;

        let ret = [];
        let prefix = this.getCombinableKeyPrefix(field);
        let index = 1;

        while (true) {
            let key = prefix + index;
            if (!this.checkKeyPrefixExisted(key)) break;

            this.combinableKey = key;
            let element = forElement(this, undefined as any);

            // 参考StringReader中的serializeArray
            if (element !== undefined) ret.push(element);
            ++index;
        }
        return ret.length > 0 ? ret : undefined;
    }

    public serializeMap<TKey, TValue>(
        _: Map<TKey, TValue> | undefined,
        _defaultValue: Map<TKey, TValue>,
        _config: IMapSerializeConfig,
        forKey: (sr: Serializer, key: TKey) => TKey,
        forValue: (sr: Serializer, value: TValue) => TValue,
    ) {
        let field = this.context.currentField!;
        let found = this.verifyDataWithCombinableKey(field);
        if (found) return found;

        let mapField = field as MapField;
        let ret = [];
        let prefix = this.getCombinableKeyPrefix(field);
        let keyKey = prefix + (mapField.keyField.config.name ?? "Key");
        let valueKey = prefix + (mapField.valueField.config.name ?? "Value");
        let index = 1;

        while (true) {
            let prefixKey = keyKey + index;
            let prefixValue = valueKey + index;
            if (!this.checkKeyPrefixExisted(prefixKey) || !this.checkKeyPrefixExisted(prefixValue)) break;

            this.combinableKey = prefixKey;
            let keyData = forKey(this, undefined as any);
            this.combinableKey = prefixValue;
            let valueData = forValue(this, undefined as any);

            // 参考StringReader中的serializeMap
            // 是Array<Array<any>>类型，是内部Array元素必须是2个，模仿Map的Array构造函数
            if (keyData && valueData) ret.push([keyData, valueData]);
            ++index;
        }

        return ret.length > 0 ? ret : undefined;
    }

    public serializeStruct(
        _: object,
        _defaultValue: object,
        _config: IObjectSerializeConfig,
        forKey: (sr: Serializer, name: string | number, value: unknown) => string,
        forValue: (sr: Serializer, key: string, value: unknown) => unknown,
    ): unknown {
        let field = this.context.currentField!;
        let found = this.verifyDataWithCombinableKey(field);
        if (found) return found;

        let structField = field as StructField;
        let ret = [];
        let prefix = this.getCombinableKeyPrefix(field);

        for (let f of structField.selfType.fields) {
            this.combinableKey = prefix + f.config.name;
            let key = forKey(this, f.config.name, this.data!);
            let value = forValue(this, key, undefined as any);
            if (value) {
                // 参考StringReader中的serializeObject
                // 和Map相同，是Array<Array<any>>类型，不同的是内部Array元素可以是1个或者2个，1个则按数组解
                ret.push([key, value]);
            }
        }
        return ret.length > 0 ? ret : undefined;
    }

    public serializeOneOf(
        _: object,
        _defaultValue: object,
        config: IOneOfSerializeConfig,
        forTypeKey: (sr: Serializer, value: unknown) => string,
        forTypeValue: (sr: Serializer, typeKey: string, value: unknown) => string,
        forKey: (sr: Serializer, typeValue: string, value: unknown) => string,
        forValue: (sr: Serializer, key: string, value: unknown) => unknown,
    ): unknown {
        let field = this.context.currentField!;
        let found = this.verifyDataWithCombinableKey(field);
        if (found) return found;

        let oneOfField = (field as OneOfField).selfType;
        let ret = [];
        let prefix = this.getCombinableKeyPrefix(field);
        let keyKey = prefix + oneOfField.keyField.config.name;
        let paramKey = prefix + oneOfField.config.paramPrefix;
        this.combinableKey = keyKey;

        let typeKey = forTypeKey(this, this.data);
        let typeValueAlias = forTypeValue(this, typeKey, this.data);

        // let typeValueAlias = oneOfField.typeValueToKeyAlias.get(typeValue);
        // assert(typeValueAlias, `key ${typeValue} not found in oneOf ${oneOfField.config.name}`);

        let targetField = oneOfField.keyAliasToMappingField.get(typeValueAlias!);
        assert(targetField, `target field ${typeValueAlias} not found in oneOf ${oneOfField.config.name}`);

        // 这里需要反查下，把原始值push进去
        let typeValue;
        for (let [k, v] of oneOfField.typeValueToKeyAlias) {
            if (typeValueAlias === v) {
                typeValue = k;
                break;
            }
        }
        ret.push(typeValue);

        // 这里为了匹配参数，需要把targetField的combinable设置为true，并且要把config.name改了
        let oldCombinable = targetField.config.combinable;
        targetField.config.combinable = oldCombinable !== undefined ? oldCombinable : true;

        this.combinableKey = paramKey;
        let fields = targetField instanceof ContainerField ? targetField.fields : [targetField];

        // 把将要解析的field列和真正的列对应下
        let separator = field.config.combinableKeySeparator ?? getGlobalConfig().combinableKeySeparator;

        let temp = new Map<string, string>();
        for (let i = 0; i < fields.length; ++i) {
            let k = this.getCombinableKeyPrefix(targetField) + fields[i].config.name;
            let v = paramKey + separator + (i + 1);
            temp.set(k, v);
            this.aliasToColumnKey.set(k, v);
        }

        // 这里需要传入alias，因为alias是真正的key
        let key = forKey(this, typeValueAlias, this.data);
        let value = forValue(this, key, undefined as any) as any;
        ret.push(value);

        // 还原回来
        targetField.config.combinable = oldCombinable;
        temp.forEach((_, k) => this.aliasToColumnKey.delete(k));

        return ret;
    }

    public checkKeyPrefixExisted(prefix: string) {
        for (let [rawKey, _] of this.rawKeyToIndex) {
            if (rawKey.startsWith(prefix)) {
                return true;
            }
        }
        return false;
    }

    public getCombinableKeyPrefix(field: Field) {
        let separator = field.config.combinableKeySeparator ?? getGlobalConfig().combinableKeySeparator;
        let name = field.config.name;
        if (this.combinableKey.length === 0) return name + separator;
        else if (!this.isCombinable(field)) return this.combinableKey;
        // else return combinableKey + getGlobalConfig().combinableKeySeparator + (name ?? "");
        else return this.combinableKey + separator;
    }

    public verifyDataWithCombinableKey(field: Field) {
        if (this.isCombinable(field)) return false;
        return this.saveDataWithCombinableKey(field);
    }

    public saveDataWithCombinableKey(field: Field): any {
        let key = this.getCombinableKeyPrefix(field);
        let rawIndex = this.rawKeyToIndex.get(key);
        if (rawIndex === undefined) {
            let realColumn = this.aliasToColumnKey.get(key);
            if (realColumn) rawIndex = this.rawKeyToIndex.get(realColumn);
        }
        if (rawIndex === undefined) return undefined;

        let ret = this.rawObj[rawIndex];
        if (ret === undefined || ret === null || ret === "") return undefined;

        let debugDesc = this.context.getCurrentDesc();
        this.debugDescToRawKey.set(debugDesc, key);
        return ret;
    }

    public isCombinable(field: Field) {
        if (field.config.combinable) return true;
        return (field as any).selfType?.config.combinable;
    }

    public getDebugInfo(context: SerializeContext): IPreProcessDebugInfo | undefined {
        let currentInfo = context.getCurrentDesc();
        for (let [k, v] of this.debugDescToRawKey) {
            if (k.startsWith(currentInfo))
                return {
                    rawKey: v,
                    rawIndex: this.rawKeyToIndex.get(v)!,
                };
        }
        return undefined;
    }
}

export class CombinePreProcess extends RawDataPreProcess {
    public rawKeyToIndex = new Map<string, number>();
    public fieldToNewKeyIndex = new Map<Field, number>();
    public helper = new CombineHelper();

    public processKeys(rawKeys: string[]): string[] {
        rawKeys.forEach((v, index) => this.rawKeyToIndex.set(v, index));
        let keyIndex = rawKeys.length;

        for (let field of this.allFields) {
            let name = field.config.name;
            this.rawKeyToIndex.set(name, keyIndex);
            if (!this.helper.isCombinable(field)) continue;

            // 追加key
            rawKeys.push(name);
            this.fieldToNewKeyIndex.set(field, keyIndex);
            ++keyIndex;
        }

        return rawKeys;
    }

    public processRawData(rawObj: any): any {
        for (let [field, index] of this.fieldToNewKeyIndex) {
            let newData = this.helper.merge(field, this.rawKeyToIndex, rawObj);
            if (newData) rawObj[index] = newData;
        }
        return rawObj;
    }

    public getDebugInfo(context: SerializeContext): IPreProcessDebugInfo | undefined {
        return this.helper.getDebugInfo(context);
    }
}
