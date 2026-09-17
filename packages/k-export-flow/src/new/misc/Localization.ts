import { IntlMessageFormat, PrimitiveType } from "intl-messageformat";

export interface ILocalizationConfig {
    type: string;
    additional?: string[];
    overrideDuplicate?: boolean;
}

let root: any = undefined;
let localizationType: string;

export function parseLocalizationConfig(config?: ILocalizationConfig) {
    let c = config ?? {
        type: "en-US",
    };
    setLocalizationType(c.type);
    if (c.additional) {
        addLocalizationFile(c.additional, c.overrideDuplicate);
    }
}

export function setLocalizationType(type: string) {
    root = {};
    localizationType = type;
    addLocalizationFile([`../../../localization/${type}.json`]);
}

export function addLocalizationFile(jsonPaths: string[], overrideDuplicate?: boolean) {
    for (let path of jsonPaths) {
        let newMessage: object;
        try {
            newMessage = require(path);
        } catch {
            throw new Error(`can not load localization file ${path}`, { cause: stacktrace() });
        }

        for (let [k, v] of Object.entries(newMessage)) {
            if (root[k] && !overrideDuplicate) {
                throw new Error(`add localization file ${path} failed, there is duplicated key ${k} in other files`);
            }

            root[k] = v;
        }
    }
}

export const STACKTRACE_ERROR_TAG = "StacktraceError";
export function stacktrace(start: number = 2, depth?: number): string {
    let error = new Error(STACKTRACE_ERROR_TAG);
    return error.stack
        ? error.stack
              .split("\n")
              .slice(start, depth ? start + depth : undefined)
              .join("\n")
        : "";
}

export function formatLoc<T = void>(key: string, values?: Record<string, PrimitiveType | T | undefined>) {
    assertWithLoc(!!root[key], "invalid-format-key", { name: key });

    let ret = new IntlMessageFormat(root[key], localizationType).format(values);
    if (Array.isArray(ret)) {
        let array = ret;
        ret = "";
        for (let v of array) ret += v;
    }
    return typeof ret === "string" ? ret : String(ret);
}

export function newLocError<T = void>(key: string, values?: Record<string, PrimitiveType | T | undefined>, cause?: any) {
    return new Error(formatLoc(key, values), { cause: cause });
}

export function assertWithLoc<T = void>(condition: any, key: string, values?: Record<string, PrimitiveType | T | undefined>): asserts condition {
    if (!condition) throw newLocError(key, values, stacktrace());
}
