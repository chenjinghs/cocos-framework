/* eslint-disable @typescript-eslint/member-ordering */
import { DataWithSchema } from "../data/Data";
import { ContainerField, EFieldType } from "../field/Base";
import { assertWithLoc } from "../misc/Localization";
import { assert } from "../misc/Util";
import { DataPostProcess } from "../processor/PostProcess";
import { ESchemaDataType } from "../schema/Base";
import type { IDataTableSchemaConfig } from "../schema/DataTableSchema";
import { Validator } from "./Base";

import type { IData } from "../data/Define";
import type { Field, IFieldConfig, SerializeContext } from "../field/Base";
import type { IValidatorConfig } from "./Base";
export enum EValidatorNumberType {
    Int = "int",
    UInt = "uint",
    Float = "float",
}

export interface INumberValidatorConfig extends IValidatorConfig {
    min?: number;
    max?: number;
    numberType: EValidatorNumberType;
}

export class NumberValidator extends Validator {
    public static testConfig(config: any) {
        return config.min !== undefined || config.max !== undefined;
    }

    public validate(value: number) {
        let config = this.getConfig<INumberValidatorConfig>();
        assertWithLoc(config.numberType !== undefined, "validator-missing-param", {
            name: this.constructor.name,
            param: "numberType",
        });

        let min;
        let max;
        switch (config.numberType) {
            case EValidatorNumberType.Int:
                min = config.min ?? Number.MIN_SAFE_INTEGER;
                max = config.max ?? Number.MAX_SAFE_INTEGER;
                break;
            case EValidatorNumberType.UInt:
                min = config.min !== undefined ? Math.max(config.min, 0) : 0;
                max = config.max ?? Number.MAX_SAFE_INTEGER;
                break;
            case EValidatorNumberType.Float:
                min = config.min ?? Number.MIN_VALUE;
                max = config.max ?? Number.MAX_VALUE;
                break;
            default:
                throw new Error(`unknown number type: ${config.numberType}`);
        }

        assertWithLoc(value >= min && value <= max, "validator-number-is-not-in-range", {
            value: value,
            min: min,
            max: max,
        });
    }
}
NumberValidator.register();

// ///////////////////////////////////////////////////////////////////
export interface IBigIntValidatorConfig extends IValidatorConfig {
    min?: bigint;
    max?: bigint;
}

export class BigIntValidator extends Validator {
    public static testConfig(config: any) {
        return config.min !== undefined || config.max !== undefined;
    }

    public validate(value: bigint) {
        let config = this.getConfig<IBigIntValidatorConfig>();
        assertWithLoc((config.min === undefined || value >= BigInt(config.min)) && (config.max === undefined || value <= BigInt(config.max)), "validator-bigint-is-not-in-range", {
            value: value,
            min: config.min ?? "NotSet",
            max: config.max ?? "NotSet",
        });
    }
}
BigIntValidator.register();

// ///////////////////////////////////////////////////////////////////
export interface ICollectionValidatorConfig extends IValidatorConfig {
    collection?: Array<number | string | bigint>;
}

export class CollectionValidator extends Validator {
    public static testConfig(config: any) {
        return config.collection !== undefined;
    }

    public validate(value: number | string | bigint, _context: SerializeContext) {
        let config = this.getConfig<ICollectionValidatorConfig>();
        assertWithLoc(config.collection !== undefined, "validator-missing-param", {
            name: this.constructor.name,
            param: "collection",
        });

        assertWithLoc(config.collection.includes(value), "validator-value-is-not-in-collection", {
            value: value,
            collection: config.collection,
        });
    }
}
CollectionValidator.register();

// ///////////////////////////////////////////////////////////////////
class DataTableKeyInfo {
    public aliasToKey = new Map<string, string | number>();
    public constructor(public data: DataWithSchema) {}
}

class DataTableKeyToBeVerifedInfo {
    public realKey: any;
    public constructor(public field: Field, public value: any, public info: string, public sourceVersion?: number) {}
}

// 防止循环引用抄了一份
interface IDataTableKeyConfig extends IFieldConfig {
    dataTableName: string | string[];
    keyType: string; // 暂时只支持一个
    useKeyAlias?: boolean;
    replaceKeyAliasWithKey?: boolean;
}

export class DataTableKeyValidator extends Validator {
    private static instance = new DataTableKeyValidator();

    private toBeReplaced = new Map<symbol, DataTableKeyToBeVerifedInfo>();
    private toBeVerified = new Array<DataTableKeyToBeVerifedInfo>();

    private tableNameToKeyInfo?: Map<string, DataTableKeyInfo>;
    private tempArray = new Array<any>(undefined);
    private postProcessRegistered = false;

    public static verifyKeyAlias(field: Field, value: any, context: SerializeContext) {
        return DataTableKeyValidator.instance.verifyKeyAliasImp(field, value, context);
    }

    public static validateAll(allData: Array<IData>) {
        DataTableKeyValidator.instance.validateAllImp(allData);
    }

    public static reset() {
        DataTableKeyValidator.instance = new DataTableKeyValidator();
    }

    public validate(value: unknown, context: SerializeContext): void {}

    public verifyKeyAliasImp(field: Field, value: any, context: SerializeContext) {
        let ret = value;
        if (value === undefined || context.namespace.length === 0) return ret;

        let config = field.config as IDataTableKeyConfig;
        let info = new DataTableKeyToBeVerifedInfo(field, value, context.getInfo(), this.getSourceVersion(context));

        if (config.useKeyAlias && config.replaceKeyAliasWithKey !== false) {
            // 直接返symbol，在后处理的时候统一换掉
            let sy = Symbol();
            this.toBeReplaced.set(sy, info);
            ret = sy;
        }

        this.toBeVerified.push(info);

        // 增加后处理
        if (!this.postProcessRegistered) {
            this.postProcessRegistered = true;
            DataPostProcess.registerAllDataPostProcess("ValidatorGlobal", DataTableKeyValidator.validateAll, Number.MAX_SAFE_INTEGER);
        }

        return ret;
    }

    public validateAllImp(allData: Array<IData>) {
        // 先收集所有表里的key alias信息
        this.collectAliasInfo(allData);

        // 验证keyAlias是否合法
        this.verifyAllKeys();

        // 收集所有需要替换的数据
        let dataToBeReplaced = this.collectDataToBeReplaced(allData);

        // 替换
        for (let data of dataToBeReplaced) {
            data.data = this.tryReplaceValue(data.data);
        }

        // 输出错误信息
        if (this.toBeReplaced.size > 0) {
            for (let [s, info] of this.toBeReplaced) {
                console.error(`there is still some key alias not replaced, keyAlias: ${info.value}, info: ${info.info}`);
            }
        }

        // 清理
        this.toBeReplaced.clear();
        this.toBeVerified.length = 0;
        this.tableNameToKeyInfo = undefined;
        this.postProcessRegistered = false;
    }

    public collectAliasInfo(allData: Array<IData>) {
        this.tableNameToKeyInfo = new Map();

        for (let data of allData) {
            if (
                data instanceof DataWithSchema &&
                // data.schema instanceof DataTableSchema &&
                data.schema.config.type === ESchemaDataType.DataTable &&
                data.data instanceof Map
            ) {
                let schema = data.schema as any; // 绕循环引用
                let config = schema.config;

                let info = new DataTableKeyInfo(data);
                this.tableNameToKeyInfo.set(data.schema.config.name, info);

                if ((data.schema as any).keyType !== 1 || !config.keyAlias) continue;

                let kv = data.data as Map<any, any>;
                let aliasKeyField = schema.nameToFields.get(config.keyAlias);
                assert(aliasKeyField, `key alias field not found, name: ${config.keyAlias} in ${schema.config.name}`);

                let aliasKey = aliasKeyField.config.alias;
                assert(aliasKey, `key alias field must have alias, name: ${config.keyAlias} in ${schema.config.name}`);

                for (let [key, value] of kv) {
                    let aliasValue = value[aliasKey] as any;
                    assertWithLoc(aliasValue !== undefined && typeof aliasValue === "string" && aliasValue.length > 0, `data-table-key-alias-must-be-valid`, {
                        file: data.getSourcePath(),
                        key: key,
                    });
                    assertWithLoc(!info.aliasToKey.has(aliasValue), `data-table-key-alias-must-be-unique`, {
                        file: data.getSourcePath(),
                        key: key,
                        alias: aliasValue,
                    });

                    info.aliasToKey.set(aliasValue, key);
                }
            }
        }
    }

    public verifyAllKeys() {
        for (let info of this.toBeVerified) {
            let config = info.field.getConfig<IDataTableKeyConfig>();
            let dtNames = this.getDataTableNames(config);
            let key;
            let lastData: DataWithSchema | undefined;
            let findAlias = config.useKeyAlias;
            let dataTableSourceFiles = new Array<string>();

            for (let dtName of dtNames) {
                let dtAliasInfo = this.tableNameToKeyInfo!.get(dtName);
                assertWithLoc(dtAliasInfo, "data-table-key-not-found", {
                    name: dtName,
                    info: info.info,
                });

                // 这里特意不break，在所有表里都找一遍，防止有重复的
                let found;
                if (findAlias) {
                    found = dtAliasInfo.aliasToKey.get(info.value);
                    assertWithLoc(key === undefined || found === undefined, "data-table-key-alias-duplicated", {
                        key: info.value,
                        file1: lastData?.getSourcePath(),
                        file2: dtAliasInfo.data.getSourcePath(),
                        info: info.info,
                    });
                } else {
                    found = this.findDataTableValue(dtAliasInfo.data, info.value, info.sourceVersion);
                    assertWithLoc(key === undefined || found === undefined, "data-table-key-duplicated", {
                        key: info.value,
                        file1: lastData?.getSourcePath(),
                        file2: dtAliasInfo.data.getSourcePath(),
                        info: info.info,
                    });
                }

                key = found ?? key;
                lastData = dtAliasInfo.data;
                dataTableSourceFiles.push(dtAliasInfo.data.getSourcePath());
            }

            assertWithLoc(key !== undefined, "data-table-key-alias-not-found", {
                alias: info.value,
                name: dataTableSourceFiles,
                info: info.info,
            });

            info.realKey = key;
        }
    }

    private getSourceVersion(context: SerializeContext) {
        let version = context.currentObject?.version;
        return typeof version === "number" ? version : undefined;
    }

    private findDataTableValue(data: DataWithSchema, key: string | number | bigint, version?: number) {
        if (!(data.data instanceof Map)) return undefined;

        let templates = data.data as Map<any, any>;
        let schemaConfig = data.schema.getConfig<IDataTableSchemaConfig>();
        if (!Array.isArray(schemaConfig.key) || schemaConfig.key[0] !== "version") {
            return templates.get(key);
        }

        let sharedTemplates = templates.get(0);
        if (sharedTemplates instanceof Map && sharedTemplates.has(key)) {
            return sharedTemplates.get(key);
        }

        if (version !== undefined && version !== 0) {
            let versionTemplates = templates.get(version);
            if (versionTemplates instanceof Map && versionTemplates.has(key)) {
                return versionTemplates.get(key);
            }
            return undefined;
        }

        let concreteVersions = Array.from(templates.keys())
            .filter((item): item is number => typeof item === "number" && item !== 0)
            .sort((a, b) => a - b);
        if (concreteVersions.length === 0) return undefined;

        let found: any;
        for (let concreteVersion of concreteVersions) {
            let versionTemplates = templates.get(concreteVersion);
            if (!(versionTemplates instanceof Map) || !versionTemplates.has(key)) {
                return undefined;
            }
            found ??= versionTemplates.get(key);
        }
        return found;
    }

    public collectDataToBeReplaced(allData: Array<IData>) {
        let checkField = (fields: Array<Field>) => {
            let config;
            for (let field of fields) {
                config = field.config;
                if (config.type === EFieldType.DataTableKey && config.useKeyAlias && config.replaceKeyAliasWithKey !== false) {
                    return true;
                } else if (field instanceof ContainerField) {
                    if (checkField(field.fields)) {
                        return true;
                    }
                }
            }
            return false;
        };

        let datas = new Array<DataWithSchema>();
        for (let data of allData) {
            if (data instanceof DataWithSchema) {
                if (checkField(data.schema.fields)) {
                    datas.push(data);
                }
            }
        }
        return datas;
    }

    public tryReplaceValue(obj: any) {
        let ret = obj;
        let t = typeof ret;
        if (t === "symbol") {
            let info = this.toBeReplaced.get(ret);

            // 如果没别的处理用symbol这种方式，那么应该assert，这里先不assert
            if (!info) return ret;

            this.toBeReplaced.delete(ret);
            return info.realKey;
        } else if (t === "object") {
            if (Array.isArray(ret)) {
                for (let i = 0; i < ret.length; i++) {
                    ret[i] = this.tryReplaceValue(ret[i]);
                }
            } else if (ret instanceof Map) {
                ret = new Map();
                for (let [key, value] of obj) {
                    ret.set(this.tryReplaceValue(key), this.tryReplaceValue(value));
                }
            } else {
                ret = {} as any;
                let replacedKey: string;
                for (let key in obj) {
                    replacedKey = this.tryReplaceValue(key);
                    assert(typeof replacedKey === "string" || typeof replacedKey === "number", `invalid key type, original key: ${key}, replacedKey: ${replacedKey}`);
                    ret[replacedKey] = this.tryReplaceValue(obj[key]);
                }
            }
        }
        return ret;
    }

    private getDataTableNames(config: IDataTableKeyConfig) {
        let dtNames = config.dataTableName;
        if (!Array.isArray(config.dataTableName)) {
            this.tempArray[0] = config.dataTableName;
            dtNames = this.tempArray;
        }
        return dtNames;
    }
}

// ///////////////////////////////////////////////////////////////////
// export class UEResourceValidator extends Validator {
//     public static testConfig(_: any) {
//         return true;
//     }

//     public validate(value: string, context: SerializeContext) {
//         // TODO...
//         return false;
//     }
// }
// UEResourceValidator.register();
