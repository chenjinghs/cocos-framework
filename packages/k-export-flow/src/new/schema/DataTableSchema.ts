/* eslint-disable complexity */
import { Schema } from "../data/Data";
import { getGlobalConfig } from "../data/Define";
import { EFieldType, Field, SerializeContext } from "../field/Base";
import { assertWithLoc, formatLoc, newLocError } from "../misc/Localization";
import { assert, getExcelColumName, getFileBaseName } from "../misc/Util";
import { ESchemaDataType } from "./Base";

import type { Serializer } from "../serializer/Base";
import type { ISchemaConfig } from "./Base";

export enum EDataTableKeyType {
    Array = 0,
    Single,
    Double,
    Triple,
    Quadruple,

    Custom,
}

export interface IDataTableSchemaConfig extends ISchemaConfig {
    key?: string | string[];
    versionFallback?: boolean; // 显式启用 version -> 0 默认层回退语义
    keyAlias?: string; // key的别名类，开启后其他表可以直接引用此列
    // removeKeyAlias?: boolean; // 是否移除keyAlias列，默认删除
    startLineNumber?: number;
    keyNameLine?: number;
    dataStartLine?: number;
    removeKeyInData?: boolean;
    removeEmptyValue?: boolean; // 对于没填的值，是否移除，默认保留，使用DefaultValue
}

export interface IRowAndCol {
    row: number;
    column: number;
}

export class DataTableSerializeContext extends SerializeContext {
    public file!: string;
    public row!: number;
    public column!: number;
    public schema!: DataTableSchema;

    public constructor(schema: DataTableSchema) {
        super();
        this.schema = schema;
    }

    public getInfo(): string {
        let debugInfo = this.schema.rawDataPreProcess.getDebugInfo(this);
        let key = debugInfo?.rawKey ?? this.currentField?.config.name;
        let col = debugInfo?.rawIndex ?? this.column;
        ++col;

        return formatLoc("data-table-info", {
            key: key,
            file: this.file,
            row: this.row,
            colName: getExcelColumName(col),
            col: col,
        });
    }
}

export class DataTableSchema extends Schema {
    private keyCol: number | Array<number> | undefined;
    private colToField!: Map<number, Field>;
    private keyType!: EDataTableKeyType;
    private defaultArrayIndexField!: Field;
    private templateToRawData = new Map<object, any>();
    private serializeContext: DataTableSerializeContext;

    public constructor() {
        super();
        this.serializeContext = new DataTableSerializeContext(this);
        this.defaultArrayIndexField = Field.create({ name: "index", type: EFieldType.Int }, this);
    }

    public async generateRawData(data: object, serializer: Serializer) {
        // 处理忽略行
        let originalRawData = Array.isArray(data) ? data : [data];
        let skipRowCount = 0;
        let config = this.getConfig<IDataTableSchemaConfig>();
        if (config.startLineNumber !== undefined) {
            skipRowCount = Math.max(0, config.startLineNumber - 1);
            if (skipRowCount > 0) originalRawData.splice(0, skipRowCount);
        }

        let rawData = originalRawData;
        if (config.keyNameLine !== undefined) {
            rawData = new Array<Array<string>>();
            rawData.push(originalRawData[config.keyNameLine - 1] as Array<string>);
        }
        if (config.dataStartLine !== undefined) {
            rawData = rawData.concat(originalRawData.slice(config.dataStartLine - 1));
            skipRowCount = Math.max(0, config.dataStartLine - 2);
        }

        assertWithLoc(rawData.length > 0, "empty-line-in-data-table", {
            file: this.source.path,
        });
        let rawKeys = rawData[0] as Array<string>;

        // 预处理
        rawKeys = this.rawDataPreProcess.processKeys(rawKeys);

        assertWithLoc(rawKeys, "can-not-find-key-in-data-table", {
            file: this.source.path,
            keys: config.key,
        });

        // 收集field以及key信息
        let nameToFields = this.nameToFields;
        this.colToField = new Map<number, Field>();
        let keyConfig = config.key;
        let field;
        let rawKey;
        this.keyCol = new Array<number>();

        // if (this.source.path.indexOf("buff_param") >= 0) {
        //     console.log(`test`);
        // }

        // 扫描key列，收集key的column信息
        for (let i = 0; i < rawKeys.length; ++i) {
            rawKey = rawKeys[i];
            field = nameToFields.get(rawKey);
            if (!field) continue;

            this.colToField.set(i, field);
            if (keyConfig !== undefined) {
                if (Array.isArray(keyConfig)) {
                    let keyIndex = keyConfig.indexOf(rawKey);
                    if (keyIndex >= 0) {
                        if (this.keyCol.length !== keyConfig.length) this.keyCol.length = keyConfig.length;
                        this.keyCol[keyIndex] = i; // 这里要按照定义的key顺序来填
                        field.config.optional = true;
                    }
                } else if (keyConfig === rawKey) {
                    this.keyCol.push(i);
                    field.config.optional = true;
                }
            }
        }

        let configKeyCount = Array.isArray(keyConfig) ? keyConfig.length : keyConfig ? 1 : 0;
        let keyCount = this.keyCol.length;
        assertWithLoc(this.keyCol.length === configKeyCount, "can-not-find-key-in-data-table", {
            file: this.source.path,
            keys: config.key,
        });
        if (keyCount === 0) this.keyCol = undefined;
        else if (keyCount === 1) this.keyCol = this.keyCol[0];

        // 序列化所有data
        let newObjs = new Array<any>();
        let rowObj;
        let currentObj;
        let currentCol;
        let currentRow;
        let keyOfIgnoreRow = getGlobalConfig().stringKeyOfIgnoreRow;
        let context = this.serializeContext;
        context.file = this.source.path;
        context.init(getFileBaseName(context.file));
        let ret;
        let rawValue;
        let rawDataToRow = new Map<object, number>();

        try {
            let colCount = rawKeys.length;
            for (let row = 1; row < rawData.length; ++row) {
                currentObj = undefined;
                currentRow = row + skipRowCount + 1;
                rowObj = rawData[row] as any;
                context.row = currentRow;

                if (rowObj[0] !== undefined && String(rowObj[0]).trim().startsWith(keyOfIgnoreRow)) continue; // 忽略#行

                let emptyLine = true;
                for (let [_, v] of Object.entries(rowObj)) {
                    if (v !== undefined) {
                        emptyLine = false;
                        break;
                    }
                }
                if (emptyLine) continue;

                // 预处理
                rowObj = this.rawDataPreProcess.processRawData(rowObj);
                currentObj = {} as any;
                let rawDataObj = {} as any;
                context.newObjInfo(String(currentRow));
                context.currentObject = currentObj;

                let valid = false;
                for (currentCol = 0; currentCol < colCount; ++currentCol) {
                    field = this.colToField.get(currentCol);
                    if (!field) continue;

                    rawValue = rowObj[currentCol];
                    if (config.removeEmptyValue === true && rawValue === undefined) continue;

                    context.column = currentCol;
                    serializer.setData(rawValue);

                    let key = this.getObjKey(field, currentCol);
                    rawDataObj[key] = rawValue;
                    currentObj[key] = field.serializeValue(serializer, undefined, this.serializeContext);
                    valid = true;
                }

                if (valid) {
                    newObjs.push(currentObj);
                    rawDataToRow.set(currentObj, currentRow);
                    this.templateToRawData.set(currentObj, rawDataObj);
                }
            }

            // 处理key
            let v;
            let removeKeyInData = config.removeKeyInData;
            currentRow = undefined;

            if (this.keyCol === undefined) {
                ret = newObjs;
                this.keyType = EDataTableKeyType.Array;
            } else if (!Array.isArray(this.keyCol)) {
                this.keyType = EDataTableKeyType.Single;
                ret = new Map();
                let keyCol = this.keyCol as number;
                currentCol = keyCol;
                field = this.colToField.get(keyCol)!;
                this.verifyKeyType(field);
                let keyName = this.getObjKey(field, keyCol);
                context.column = keyCol;
                context.currentField = field;

                for (currentObj of newObjs) {
                    v = currentObj[keyName];
                    context.row = rawDataToRow.get(currentObj)!;
                    assertWithLoc(!ret.has(v), "duplicated-key-in-data-table", {
                        key: keyName,
                        value: v,
                    });

                    ret.set(v, currentObj);
                    assertWithLoc(v !== undefined, "key-can-not-be-empty-in-data-table", {
                        key: keyName,
                    });
                    if (removeKeyInData) currentObj[keyName] = undefined;
                }
            } else {
                // TODO: 这里暂时没想法，先用多级map吧
                ret = new Map();
                let subMap;
                let keyName;
                let v;
                let keyCount = this.keyCol.length;
                this.keyType = keyCount;
                for (currentObj of newObjs) {
                    subMap = ret;
                    for (let i = 0; i < keyCount; ++i) {
                        currentCol = this.keyCol[i];
                        field = this.colToField.get(currentCol)!;
                        context.column = currentCol;
                        context.row = rawDataToRow.get(currentObj)!;
                        context.currentField = field;
                        this.verifyKeyType(field);
                        keyName = this.getObjKey(field, currentCol);
                        v = currentObj[keyName];
                        assertWithLoc(v !== undefined, "multi-key-can-not-be-empty-in-data-table", { key: keyName });

                        if (i !== keyCount - 1) {
                            let temp = subMap.get(v);
                            if (!temp) {
                                temp = new Map();
                                subMap.set(v, temp);
                            }
                            subMap = temp;
                        } else {
                            assertWithLoc(!subMap.has(v), "duplicated-multi-key-in-data-table", {
                                key: keyName,
                            });
                            subMap.set(v, currentObj);
                            if (removeKeyInData) currentObj[keyName] = undefined;
                        }
                    }
                }
            }
        } catch (err: any) {
            throw newLocError(
                "data-table-error",
                {
                    error: err.message,
                    info: this.serializeContext.getInfo(),
                },
                err,
            );
        }

        return ret;
    }

    public getKeyType() {
        return this.keyType;
    }

    public setCustomKey() {
        this.keyType = EDataTableKeyType.Custom;
    }

    public getKeyField(): undefined | Field | Array<Field> {
        switch (this.getKeyType()) {
            case EDataTableKeyType.Custom:
                return undefined;
            case EDataTableKeyType.Array:
                return this.defaultArrayIndexField;
            case EDataTableKeyType.Single: {
                assert(typeof this.keyCol === "number", `key col should be number, keyCol: ${this.keyCol}`);
                let keyField = this.colToField.get(this.keyCol);
                assert(keyField, `can not find key col: ${this.keyCol}`);
                return keyField;
            }
            default: {
                assert(Array.isArray(this.keyCol), `key col should be array, keyCol: ${this.keyCol}`);
                let keyFields = new Array<Field>();
                let field;
                for (let col of this.keyCol) {
                    field = this.colToField.get(col);
                    assert(field, `can not find key col: ${col}`);
                    keyFields.push(field);
                }
                return keyFields;
            }
        }
    }

    public verifyKeyType(field: Field) {
        switch (field.config.type) {
            case EFieldType.Int:
            case EFieldType.UInt:
            case EFieldType.Float:
            case EFieldType.BigInt:
            case EFieldType.String:
            case EFieldType.DataTableKey:
                return true;
            default:
                assertWithLoc(false, "data-table-key-type-is-not-supported", {
                    type: field.config.type,
                });
        }
    }

    public getTableName() {
        let config = this.getConfig<IDataTableSchemaConfig>();
        return config.name;
    }

    public addOwnedField(_field: Field) {}

    public getTemplateRawData(template: object) {
        return this.templateToRawData.get(template);
    }

    public override copyDeclaration(source: DataTableSchema) {
        this.keyType = source.keyType;
        this.keyCol = source.keyCol;
        this.defaultArrayIndexField = source.defaultArrayIndexField;
        this.colToField = source.colToField;
        this.declarationSet = source.declarationSet;
    }

    private getObjKey(field: Field, col: number) {
        return field.config.alias ?? `NoAlias_${col}`;
    }
}
DataTableSchema.register(ESchemaDataType.DataTable);
