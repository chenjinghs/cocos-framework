// 扩展类型

import { assertWithLoc } from "../misc/Localization";
import { DataTableKeyValidator } from "../validator";
import { EFieldType, Field, FieldDeclaration } from "./Base";
import { ArrayField } from "./Field";

import type { Serializer } from "../serializer/Base";
import type { IFieldConfig, SerializeContext } from "./Base";
// ///////////////////////////////////////////////////////////////////
// export class L10NField extends Field {
//     public generateDeclaration(interfaces: Map<Field, InterfaceDeclaration>) {
//         return new FieldDeclaration(this.config.type, this.config.optional);
//     }

//     protected serialize(s: Serializer, value: any, context: SerializeContext) {
//         if (s.isReader()) {
//             let v = s.serialize(value, String(this.config.default ?? ""), this.config);
//             if (v === undefined) return undefined;

//             if (typeof v === "string") {
//                 return {
//                     namespace: context.namespace,
//                     key: context.getCurrentDesc(),
//                     text: v,
//                     [getGlobalConfig().defaultExtraDataKeyInJson]: EFieldType.L10N,
//                 };
//             } else {
//                 assertWithLoc(
//                     typeof v === "object" && v !== null && "namespace" in v && "key" in v && "text" in v,
//                     "field-serialize-read-failed",
//                     { type: EFieldType.L10N, value: v },
//                 );
//             }
//             return v;
//         } else {
//             let v = value;
//             if (typeof v === "string") {
//                 v = {
//                     namespace: context.namespace,
//                     key: context.getCurrentDesc(),
//                     text: value,
//                     [getGlobalConfig().defaultExtraDataKeyInJson]: EFieldType.L10N,
//                 };
//             } else {
//                 assertWithLoc(
//                     typeof v === "object" && v !== null && "namespace" in v && "key" in v && "text" in v,
//                     "field-serialize-write-failed",
//                     { type: EFieldType.L10N, value: v },
//                 );
//             }
//             return s.serialize(v, String(this.config.default ?? ""), this.config);
//         }
//     }

//     protected onCreateValidator() {
//         verifyValidator(this, CollectionValidator);
//     }
// }
// L10NField.register(EFieldType.L10N);

// ///////////////////////////////////////////////////////////////////
const DEFAULT_KEY_ALIAS_TYPE = "string";
export interface IDataTableKeyConfig extends IFieldConfig {
    dataTableName: string | string[];
    keyType: string; // 暂时只支持一个
    useKeyAlias?: boolean;
    keyAliasType?: string;
    replaceKeyAliasWithKey?: boolean;
    ignoreKeyList?: string[] | number[];
}

export class DataTableKeyField extends Field {
    public static reset() {
        DataTableKeyValidator.reset();
    }

    public onCreate() {
        let config = this.getConfig<IDataTableKeyConfig>();
        assertWithLoc(config.keyType !== undefined, "data-table-key-type-missing");

        // if (Array.isArray(config.keyType)) {
        //     for (let type of config.keyType)
        //         assertWithLoc(this.isValidKeyType(type), "data-table-key-type-is-not-supported", {
        //             type: config.keyType,
        //         });
        // } else
        if (typeof config.keyType === "string") {
            assertWithLoc(this.isValidKeyType(config.keyType), "data-table-key-type-is-not-supported", {
                type: config.keyType,
            });
        } else throw new Error(`invalid data table key type ${String(config.keyType)}`);
    }

    public generateDeclaration(interfaces: Map<Field, FieldDeclaration>) {
        let config = this.getConfig<IDataTableKeyConfig>();

        // if (Array.isArray(config.keyType)) {
        //     return new ArrayFieldDeclaration(config.keyType, config.optional);
        // } else {
        return new FieldDeclaration(config.keyType, config.optional);
        // }
    }

    protected serialize(s: Serializer, value: unknown, context: SerializeContext) {
        let config = this.getConfig<IDataTableKeyConfig>();
        assertWithLoc(config.dataTableName !== undefined, "validator-missing-param", {
            name: this.constructor.name,
            param: "dataTableName",
        });

        if (config.useKeyAlias) {
            // assertWithLoc(config.keyAliasType, "data-table-key-alias-type-is-invalid", { keyAlias: config.keyAlias });
            return this.serializeWithType(config.keyAliasType ?? DEFAULT_KEY_ALIAS_TYPE, s, value, context, config.ignoreKeyList);
        } else if (Array.isArray(config.keyType)) {
            let dataIndex = 0;
            return s.serializeArray(value as unknown[], this.getDefaultValueFromConfig(context, ArrayField.defaultValue), this.config, (sr: Serializer, element: unknown) => {
                return this.serializeWithType(config.keyType[dataIndex++], sr, value, context, config.ignoreKeyList);
            });
        } else {
            return this.serializeWithType(config.keyType, s, value, context, config.ignoreKeyList);
        }
    }

    private isValidKeyType(type: string) {
        switch (type as EFieldType) {
            case EFieldType.String:
            case EFieldType.Int:
            case EFieldType.BigInt:
            case EFieldType.UInt:
                return true;
        }
        return false;
    }

    private serializeWithType(type: string, s: Serializer, value: unknown, context: SerializeContext, ignores?: string[] | number[]) {
        let ret: any;
        let needVerify = true;
        switch (type as EFieldType) {
            case EFieldType.String:
                ret = s.serializeString(value as string, this.config, String(this.config.default ?? ""));
                if (ignores && (ignores as string[]).includes(ret)) needVerify = false;
                break;
            case EFieldType.Int:
            case EFieldType.UInt:
                ret = s.serializeNumber(value as number, this.config, Number(this.config.default ?? 0));
                if (ignores && (ignores as number[]).includes(ret)) needVerify = false;
                break;
            case EFieldType.BigInt:
                ret = s.serializeBigInt(value as bigint, this.config, BigInt(this.config.default ?? 0));
                if (ignores && (ignores as number[]).includes(Number(ret))) needVerify = false;
                break;
            default:
                throw new Error("invalid type of data table key");
        }

        if (needVerify) ret = DataTableKeyValidator.verifyKeyAlias(this, ret, context);
        return ret;
    }
}
DataTableKeyField.register(EFieldType.DataTableKey);

// //////////////////////////////////////////////////////////////////////
// export class UEResourceField extends StringField {
//     protected onCreateValidator() {
//         verifyValidator(this, UEResourceValidator);
//     }
// }
// UEResourceField.register(EFieldType.UEResource);
