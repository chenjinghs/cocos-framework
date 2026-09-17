// eslint-disable-next-line @typescript-eslint/no-require-imports
const clone = require("rfdc")();

export type Constructor<T = any> = new (...args: any) => T;
export type DataType = Constructor<IData> | undefined;

export interface IData {
    getDescription: () => string;
}

// ///////////////////////////////////////////////////////////////////////////////////////////////////
const DEFAULT_GLOBAL_CONFIG = {
    localization: {
        type: "zh-CN",
        // type: "en-US",
    },
    defaultOneOfKeyName: "oneOfType",
    defaultOneOfParamPrefix: "param",
    defaultExportInfoBeginKey: "// [EXPORT_BEGIN]",
    defaultExportInfoEndKey: "// [EXPORT_END]",

    stringArraySeparator: ",",
    stringMapElementSeparator: "&",
    stringMapKeyValueSeparator: ":",
    stringObjElementSeparator: "|",
    stringObjNameValueSeparator: ":",
    stringOneOfKeySeparator: "|",
    stringKeyOfIgnoreRow: "#",

    defaultExtraDataKeyInJson: "__extra__",
    defaultExportMapInJson: true,
    defaultIniKeyValueSeparator: "=",
    ueContentPath: undefined,
    combinableKeySeparator: "_",
    floatPrecision: 5,
};

export type IGlobalConfig = typeof DEFAULT_GLOBAL_CONFIG;
export function createDefaultGlobalConfig(): IGlobalConfig {
    return clone(DEFAULT_GLOBAL_CONFIG);
}

let globalConfig: IGlobalConfig;
export function setGlobalConfig(config: IGlobalConfig) {
    globalConfig = config;
}

export function getGlobalConfig() {
    if (!globalConfig) throw new Error(`there is no global config`);
    return globalConfig;
}
