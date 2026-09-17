/* eslint-disable complexity */
import { getGlobalConfig } from "../data/Define";
import { assertWithLoc, newLocError } from "../misc/Localization";
import { assert, getFileBaseName } from "../misc/Util";
import { ESchemaDataType } from "./Base";
import { IniSchema } from "./IniSchema";

import type { Serializer } from "../serializer/Base";
import type { ISchemaConfig } from "./Base";
export interface IDataTableIniSchemaConfig extends ISchemaConfig {
    startLineNumber?: number;
    key: string;
    value: string | string[];
    keyNameLine?: number;
    dataStartLine?: number;
}

export class DataTableIniSchema extends IniSchema {
    public async generateRawData(data: object, serializer: Serializer) {
        // 处理raw data部分和data table一样
        // 处理忽略行
        let originalRawData = Array.isArray(data) ? data : [data];
        let skipRowCount = 0;
        let config = this.getConfig<IDataTableIniSchemaConfig>();
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

        // 收集value列信息
        assertWithLoc(rawData.length > 0, "empty-line-in-ini", { file: this.source.path });
        assert(config.key !== undefined, `key is undefined in ini config: ${this.source.path}`);
        assert(config.value !== undefined, `value is undefined in ini config: ${this.source.path}`);
        let rawKeys = rawData[0] as Array<string>;

        let keyConfig = config.key;
        let valueConfig = config.value;
        let keyCol: number | undefined;
        let valueCols = new Array<number>();
        let rawKey;

        // 预处理
        rawKeys = this.rawDataPreProcess.processKeys(rawKeys);
        rawData = this.rawDataPreProcess.processRawData(rawData);

        for (let i = 0; i < rawKeys.length; ++i) {
            if (!rawKeys[i]) continue;
            rawKey = rawKeys[i].trim();
            if (keyConfig === rawKey) keyCol = i;
            else {
                if (Array.isArray(valueConfig)) {
                    if (valueConfig.indexOf(rawKey) >= 0) valueCols.push(i);
                } else if (valueConfig === rawKey) {
                    valueCols.push(i);
                }
            }
        }
        assertWithLoc(keyCol !== undefined && valueCols.length > 0, "can-not-find-key-in-data-table", {
            file: this.source.path,
            keys: config.key,
        });

        // 序列化所有data
        let rowObj;
        let keyOfIgnoreRow = getGlobalConfig().stringKeyOfIgnoreRow;
        let valueField;
        let ret = {} as any;

        let context = this.serializeContext;
        context.file = this.source.path;
        context.init(getFileBaseName(context.file));
        context.newObjInfo();

        try {
            for (let row = 1; row < rawData.length; ++row) {
                context.row = row + skipRowCount + 1;
                rowObj = rawData[row] as Array<any>;

                if (rowObj.length === 0) continue; // 忽略空行
                if (rowObj[0] !== undefined && String(rowObj[0]).trim().startsWith(keyOfIgnoreRow)) continue; // 忽略#行

                let key = rowObj[keyCol!] as string;
                assertWithLoc(key !== undefined, "ini-key-can-not-be-empty");

                valueField = this.nameToFields.get(key);
                if (!valueField) continue;

                let value: any;
                for (const vc of valueCols) {
                    if (value === undefined) value = rowObj[vc];
                    else assertWithLoc(vc !== undefined && rowObj[vc] === undefined, "duplicated-value-in-data-table-ini");
                }

                assert(valueField.config.alias !== undefined, `alias is undefined in ini config, name: ${valueField.config.name}`);
                serializer.setData(value);
                ret[valueField.config.alias] = valueField.serializeValue(serializer, undefined, this.serializeContext);
            }
            return ret;
        } catch (err: any) {
            throw newLocError(
                "ini-error",
                {
                    error: err.message,
                    info: this.serializeContext.getInfo(),
                },
                err,
            );
        }
    }
}
DataTableIniSchema.register(ESchemaDataType.DataTableIni);
