import fs from "node:fs";
import path from "node:path";

// 项目配置表基线固定为 ZH_CN；运行时默认语言由 language-runtime-config.json 控制。
export const DEFAULT_LANG = "ZH_CN";

/**
 * 消费项目内的约定路径。框架约定项目根目录包含:
 *   ProjectSettings/language-runtime-config.json
 *   ExternalConfig/export-flow-setting/...   (k-export-flow 管线配置)
 *   TempSaved/export-flow/...                (管线中间产物)
 *   OptionalExtensions/Localization/...      (本地化资源包)
 */
export interface ILocalizationPaths {
    projectRoot: string;
    languageRuntimeConfigPath: string;
    translationConfigDir: string;
    translationSourceDir: string;
    translationOutputDir: string;
    localizationRootDir: string;
    backupDir: string;
}

export function resolvePaths(projectRoot: string): ILocalizationPaths {
    const root = path.resolve(projectRoot);
    return {
        projectRoot: root,
        languageRuntimeConfigPath: path.join(root, "ProjectSettings/language-runtime-config.json"),
        translationConfigDir: path.join(root, "ExternalConfig/export-flow-setting/client/config/localization"),
        translationSourceDir: path.join(root, "TempSaved/export-flow/output/client/config"),
        translationOutputDir: path.join(root, "ExternalConfig/design-config/new_src/localization"),
        localizationRootDir: path.join(root, "OptionalExtensions/Localization"),
        backupDir: path.join(root, "Temp/Localization/Backup"),
    };
}

interface ILanguageRuntimeConfig {
    project?: {
        language?: string;
        languages?: string[];
    };
}

function normalizeLanguageList(languages: unknown) {
    if (!Array.isArray(languages)) return [];
    let ret: string[] = [];
    let seen = new Set<string>();
    for (let value of languages) {
        let language = String(value).trim();
        if (language.length <= 0 || seen.has(language)) continue;
        seen.add(language);
        ret.push(language);
    }
    return ret;
}

// 为了防止输入错误的语言代码，从 language-runtime-config.json 读取本地区有效语言。
export function loadValidLangs(configPath: string): string[] {
    if (!fs.existsSync(configPath)) throw new Error(`找不到语言运行时配置：${configPath}`);
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8")) as ILanguageRuntimeConfig;
    const languages = normalizeLanguageList(config.project?.languages);
    if (languages.length <= 0) throw new Error(`语言运行时配置缺少 project.languages：${configPath}`);
    if (!languages.includes(DEFAULT_LANG)) {
        languages.unshift(DEFAULT_LANG);
    }
    return languages;
}
