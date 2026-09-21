import { Schema } from "../data/Data";
import { getGlobalConfig } from "../data/Define";
import { SerializeContext } from "../field/Base";
import { formatLoc, newLocError } from "../misc/Localization";
import { assert, getFileBaseName } from "../misc/Util";
import { Serializer } from "../serializer/Base";
import { ESchemaDataType, ISchemaConfig } from "./Base";

export interface IIniSchemaConfig extends ISchemaConfig {
    startLineNumber?: number;
    separator?: string;
}

export class SContext extends SerializeContext {
    public file!: string;
    public row!: number;

    public getInfo(): string {
        return formatLoc("ini-info", {
            key: this.currentField?.config?.name,
            file: this.file,
            row: this.row,
        });
    }
}

export class IniSchema extends Schema {
    public serializeContext = new SContext();

    public async generateRawData(data: object, serializer: Serializer) {
        try {
            assert(Array.isArray(data), "data must be an array in ini schema");

            let ret = {} as any;
            let context = this.serializeContext;
            context.file = this.source.path;
            context.init(getFileBaseName(context.file));
            context.newObjInfo(ret);

            let keyOfIgnoreRow = getGlobalConfig().stringKeyOfIgnoreRow;
            let rawKeys = new Array<string>();
            let rawData = new Array<string>();

            // 收集信息
            for (let row = 0; row < data.length; ++row) {
                context.row = row;
                let kv = data[row] as string[];
                assert(Array.isArray(kv), "data must be an array in ini schema");

                if (kv.length === 0) continue;
                if (kv[0].trim().startsWith(keyOfIgnoreRow)) continue; // 忽略#行

                let key = kv[0].trim();
                let value = kv.length > 1 ? kv[1].trim() : undefined;
                if (!value) continue;

                rawKeys.push(key);
                rawData.push(value);
            }

            // 预处理
            rawKeys = this.rawDataPreProcess.processKeys(rawKeys);
            rawData = this.rawDataPreProcess.processRawData(rawData);

            // 序列化
            context.row = 0; // 重置行号
            for (let i = 0; i < rawKeys.length; ++i) {
                let key = rawKeys[i];
                let value = rawData[i];
                let valueField = this.nameToFields.get(key);
                if (!valueField) continue;

                assert(valueField.config.alias !== undefined, `alias is undefined in ini config, name: ${valueField.config.name}`);
                serializer.setData(value);
                ret[valueField.config.alias] = valueField.serializeValue(serializer, value, this.serializeContext);
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
IniSchema.register(ESchemaDataType.Ini);
