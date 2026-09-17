import type { DataWithSchema } from "../data/Data";
import { EFieldType } from "../field/Base";
import { registerDataPostProcess } from "../processor/Util";
import { addExtraData } from "../schema/Util";
import { assert } from "./Util";

export interface IExportNumberKeyInfoConfig {
    exportMinKey?: boolean;
    exportMaxKey?: boolean;
    exportKeyCount?: boolean;

    startKey?: number;
    checkContinuous?: boolean;
}

registerDataPostProcess("exportNumberKeyInfo", (output: DataWithSchema, config: IExportNumberKeyInfoConfig) => {
    let templates = output.data as any;
    if (!templates || !config) return;

    let minKey: number | undefined;
    let maxKey: number | undefined;
    let keyCount = 0;
    let startKey = config.startKey ?? 1;

    for (let [k, _] of templates) {
        let key = Number(k);
        if (isNaN(key) || !Number.isInteger(key)) {
            console.warn(`key is not number, key: ${k}`);
            return;
        }

        if (config.checkContinuous && startKey + keyCount !== key) {
            throw new Error(`key is not continuous, key: ${k}`);
        }

        if (minKey === undefined || key < minKey) {
            minKey = key;
        }
        if (maxKey === undefined || key > maxKey) {
            maxKey = key;
        }

        ++keyCount;
    }

    let extraData = [] as string[];
    if (config.exportMinKey) {
        extraData.push(`export const MIN_KEY = ${minKey};`);
    }

    if (config.exportMaxKey) {
        extraData.push(`export const MAX_KEY = ${maxKey};`);
    }

    if (config.exportKeyCount) {
        extraData.push(`export const KEY_COUNT = ${keyCount};`);
    }

    if (extraData.length > 0) addExtraData(output, extraData);
});

// ////////////////////////////////////////////////////////////////////////////////////////////////////////////
export interface IExportTemplateGroupConfig {
    groupKeyAlias: string;
}

registerDataPostProcess("ExportTemplateGroup", (output: DataWithSchema, config?: IExportTemplateGroupConfig) => {
    let templates = output.data as Map<any, any>;
    if (!templates || !config || !(templates instanceof Map)) return;

    let typeField = output.schema.aliasToFields.get(config.groupKeyAlias);
    assert(typeField, `group key not found: ${config.groupKeyAlias}, schema: ${output.schema.config.name}`);

    let type = typeField.getType();
    let typeDesc: string;
    switch (type) {
        case EFieldType.BigInt:
            typeDesc = "bigint";
            break;
        case EFieldType.Int:
        case EFieldType.UInt:
            typeDesc = "number";
            break;
        case EFieldType.String:
            typeDesc = "string";
            break;
        default:
            assert(false, `invalid group key type: ${type}, schema: ${output.schema.config.name}`);
    }

    let convert = (v: unknown) => {
        // 转换类型只支持string和整数
        if (Number.isInteger(v)) return v;
        else if (typeof v === "bigint") return v.toString();
        else if (typeof v === "string") return `"${v}"`;
        else assert(false, `invalid key type: ${typeof v}`);
    };

    let groups = new Map<any, any>();
    for (let [k, v] of templates) {
        let group = v[config.groupKeyAlias];
        if (!group) continue;

        let groupTemplates = groups.get(group);
        if (!groupTemplates) {
            groupTemplates = new Array();
            groups.set(group, groupTemplates);
        }
        groupTemplates.push(k);
    }
    if (groups.size === 0) return;

    let extraData = [] as string[];
    extraData.push(`export const TEMPLATE_GROUP_IDS = new Map([`);
    for (let [k, v] of groups) extraData.push(`\t[${convert(k)}, [${v.map(convert).join(", ")}]],`);
    extraData.push(`]);\n`);

    extraData.push(`export function getTemplateGroup(groupId: ${typeDesc}) {`);
    extraData.push(`\tlet ids = TEMPLATE_GROUP_IDS.get(groupId);`);
    extraData.push(`\tF.assert(ids, "invalid group id: " + groupId);`);
    extraData.push(`\treturn ids.map(getTemplate);`);
    extraData.push(`}`);

    addExtraData(output, extraData);
});

// ////////////////////////////////////////////////////////////////////////////////////////////////////////////
export interface IExportFiledToArrayConfig {
    filed: string;
    exportedName: string;
    filterNotValid?: boolean;
}

registerDataPostProcess("ExportFiledToArray", (output: DataWithSchema, config?: IExportFiledToArrayConfig) => {
    assert(config, `ExportFiledToArray config is not found`);

    let templates = output.data as Map<any, any>;
    let arr: any[] = [];
    templates.forEach((v) => {
        if (config.filterNotValid && !v[config.filed]) return;
        arr.push(v[config.filed]);
    });

    let extraData = [] as string[];
    extraData.push(`export const ${config!.exportedName} = [${arr.join(", ")}];`);
    addExtraData(output, extraData);
});