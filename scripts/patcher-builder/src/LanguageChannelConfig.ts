import * as fs from "fs-extra";
import * as path from "path";

export interface ILanguageRuntimeConfigFile {
    project?: {
        language?: string;
        languages?: string[];
        resPackLanguages?: string[];
        resBaseLanguage?: string;
    };
    runtime?: {
        defaultLanguage?: string;
        builtinLanguages?: string[];
        hiddenLanguages?: string[];
    };
}

const DEFAULT_LANGUAGE_MATCHERS = [
    "^packages/<lang>/",
    "^packages/deflate_config_<lang>\\.zip$",
];
const LANGUAGE_CODE_PATTERN = "[A-Z]{2}(?:_[A-Z0-9]+)+";
const PACKAGE_LANGUAGE_DIR_MATCHER = new RegExp(`^packages/(${LANGUAGE_CODE_PATTERN})(?:/|$)`, "i");
const DEFLATE_CONFIG_LANGUAGE_MATCHER = new RegExp(`^packages/deflate_config_(${LANGUAGE_CODE_PATTERN})\\.zip$`, "i");

export interface IResolvedLanguageChannelConfig {
    defaultLanguage?: string;
    builtinLanguages: string[];
    languages: string[];
    ignoreLanguages: Set<string>;
    activeLanguages: string[];
    languageMatchers: string[];
    builtinMatchers: RegExp[];
    languageToMatchers: Map<string, RegExp[]>;
    sourcePath: string;
}

export type TLanguageChannelResult =
    | { kind: "common" }
    | { kind: "ignored"; language: string }
    | { kind: "language"; language: string };

const FIXED_COMMON_FILE_PATHS = new Set([
    "packages/l10n-links.json",
    "packages/deflate_config_index.zip",
    "packages/deflate_config_default.zip",
    "packages/deflate_config_stage_battle.zip",
]);

function assert(condition: any, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function escapeRegExp(input: string) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(input: string) {
    return input.replaceAll("\\", "/");
}

function normalizeLanguageMatchPath(input: string) {
    let normalized = normalizePath(input);
    if (normalized.endsWith(".meta")) {
        normalized = normalized.substring(0, normalized.length - ".meta".length);
    }
    if (normalized.endsWith(".manifest")) {
        normalized = normalized.substring(0, normalized.length - ".manifest".length);
    }
    return normalized;
}

function getLanguageLikePathCode(relativePath: string) {
    let normalizedPath = normalizeLanguageMatchPath(relativePath);
    let packageMatch = normalizedPath.match(PACKAGE_LANGUAGE_DIR_MATCHER);
    if (packageMatch) return packageMatch[1].toUpperCase();

    let deflateConfigMatch = normalizedPath.match(DEFLATE_CONFIG_LANGUAGE_MATCHER);
    return deflateConfigMatch?.[1].toUpperCase();
}

function normalizeLanguageList(values: string[] | undefined) {
    let ret = new Array<string>();
    let seen = new Set<string>();
    for (let value of values ?? []) {
        let normalized = String(value).trim();
        if (normalized.length <= 0 || seen.has(normalized)) continue;
        seen.add(normalized);
        ret.push(normalized);
    }
    return ret;
}

function resolveRuntimeConfigPath(languageRuntimeConfigPath?: string) {
    let candidates = [
        languageRuntimeConfigPath ? path.resolve(languageRuntimeConfigPath) : "",
        path.resolve(process.cwd(), "../ProjectSettings/language-runtime-config.json"),
        path.resolve(process.cwd(), "../../ProjectSettings/language-runtime-config.json"),
        path.resolve(__dirname, "../../../../ProjectSettings/language-runtime-config.json"),
    ].filter((value) => value.length > 0);

    return candidates.find((candidate) => fs.existsSync(candidate));
}

// 读取由 export-flow 生成的 patch-common/src/LanguageDefine.ts 里的 EGameLanguage 枚举值集合。
// patch-common 在 Node 下不可 import(其 LanguageDefine 顶层引用了 Unity 运行时全局 CS)，故直接解析源文件。
function readGeneratedGameLanguages(): Set<string> | undefined {
    let candidates = [
        path.resolve(__dirname, "../../../packages/patch-common/src/LanguageDefine.ts"),
        path.resolve(process.cwd(), "../packages/patch-common/src/LanguageDefine.ts"),
        path.resolve(process.cwd(), "packages/patch-common/src/LanguageDefine.ts"),
    ].filter((value) => fs.existsSync(value));
    let file = candidates[0];
    if (!file) return undefined;

    let content = fs.readFileSync(file, "utf-8");
    let enumMatch = content.match(/enum\s+EGameLanguage\s*\{([\s\S]*?)\}/);
    if (!enumMatch) return undefined;

    let languages = new Set<string>();
    let memberRegex = /=\s*"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = memberRegex.exec(enumMatch[1])) !== null) {
        languages.add(m[1]);
    }
    return languages.size > 0 ? languages : undefined;
}

export function loadLanguageChannelConfig(languageRuntimeConfigPath?: string) {
    let finalPath = languageRuntimeConfigPath ? path.resolve(languageRuntimeConfigPath) : "";
    if (finalPath) {
        assert(fs.existsSync(finalPath), `language runtime config not found: ${finalPath}`);
    }

    let resolvedConfigPath = resolveRuntimeConfigPath(finalPath);
    let rawConfig = resolvedConfigPath
        ? (JSON.parse(fs.readFileSync(resolvedConfigPath, "utf-8")) as ILanguageRuntimeConfigFile)
        : undefined;

    let projectLanguage = String(rawConfig?.project?.language ?? "").trim();
    let allLanguages = normalizeLanguageList(rawConfig?.project?.languages);
    let resPackLanguages = normalizeLanguageList(rawConfig?.project?.resPackLanguages);
    let builtinLanguages = normalizeLanguageList(rawConfig?.runtime?.builtinLanguages);
    let hiddenLanguages = normalizeLanguageList(rawConfig?.runtime?.hiddenLanguages);
    let languageMatchers = normalizeLanguageList(DEFAULT_LANGUAGE_MATCHERS);

    assert(projectLanguage.length > 0, "project.language must be set");
    assert(languageMatchers.length > 0, "languageMatchers must not be empty");

    // languages = allLanguages excluding projectLanguage (projectLanguage is "common")
    let languages = allLanguages.filter((language) => language !== projectLanguage);

    // ignoreLanguages = languages NOT in resPackLanguages (not building resource packs for them), plus hiddenLanguages
    let ignoreLanguages = languages.filter((language) => !resPackLanguages.includes(language) || hiddenLanguages.includes(language));

    for (let language of resPackLanguages) {
        assert(allLanguages.includes(language), `resPackLanguages must be a subset of project.languages: ${language}`);
    }
    for (let language of builtinLanguages) {
        assert(allLanguages.includes(language), `builtinLanguages must be a subset of project.languages: ${language}`);
    }
    for (let language of hiddenLanguages) {
        assert(allLanguages.includes(language), `hiddenLanguages must be a subset of project.languages: ${language}`);
    }
    for (let language of hiddenLanguages) {
        assert(!builtinLanguages.includes(language), `hidden language "${language}" must not be in runtime.builtinLanguages`);
    }
    for (let language of hiddenLanguages) {
        assert(!resPackLanguages.includes(language), `hidden language "${language}" must not be in project.resPackLanguages`);
    }
    let defaultLanguage = String(rawConfig?.runtime?.defaultLanguage ?? "").trim();
    if (defaultLanguage.length > 0) {
        assert(builtinLanguages.includes(defaultLanguage), `runtime.defaultLanguage (${defaultLanguage}) must be in runtime.builtinLanguages`);
    }

    // 校验 config 里的语言都在生成的 EGameLanguage 枚举内。若有人改了 language-runtime-config 的语言列表却
    // 忘了重跑 export-flow 重新生成 patch-common/LanguageDefine.ts，这里会失败并提示重新生成，避免运行时枚举漂移
    // (客户端 createBaseManifest/getPossibleLanguageChannels 等以枚举为真，新增语言会识别不全)。
    let generatedLanguages = readGeneratedGameLanguages();
    if (generatedLanguages) {
        for (let language of [projectLanguage, ...allLanguages]) {
            assert(
                generatedLanguages.has(language),
                `language "${language}" in language-runtime-config is not in the generated EGameLanguage enum (patch-common/src/LanguageDefine.ts). Re-run export-flow to regenerate it.`,
            );
        }
    } else {
        console.warn("[LanguageChannelConfig] generated EGameLanguage enum not found, skip language enum validation");
    }

    for (let matcher of languageMatchers) {
        assert(matcher.includes("<lang>"), `languageMatchers must contain <lang>: ${matcher}`);
    }

    // builtinMatchers only for projectLanguage (treated as "common")
    let builtinMatchers = languageMatchers.map((matcher) => new RegExp(matcher.replaceAll("<lang>", escapeRegExp(projectLanguage)), "i"));
    let languageToMatchers = new Map<string, RegExp[]>();
    for (let language of languages) {
        languageToMatchers.set(language, languageMatchers.map((matcher) => new RegExp(matcher.replaceAll("<lang>", escapeRegExp(language)), "i")));
    }

    return {
        defaultLanguage,
        builtinLanguages,
        languages,
        ignoreLanguages: new Set(ignoreLanguages),
        activeLanguages: languages.filter((language) => !ignoreLanguages.includes(language)),
        languageMatchers,
        builtinMatchers,
        languageToMatchers,
        sourcePath: resolvedConfigPath ?? finalPath,
    } as IResolvedLanguageChannelConfig;
}

export function classifyLanguageChannelPath(relativePath: string, config: IResolvedLanguageChannelConfig): TLanguageChannelResult {
    let normalizedPath = normalizeLanguageMatchPath(relativePath);
    if (FIXED_COMMON_FILE_PATHS.has(normalizedPath.toLowerCase())) {
        return { kind: "common" };
    }

    if (config.builtinMatchers.some((matcher) => matcher.test(normalizedPath))) {
        return { kind: "common" };
    }

    let matchedLanguages = new Array<string>();
    for (let language of config.languages) {
        let matchers = config.languageToMatchers.get(language)!;
        if (matchers.some((matcher) => matcher.test(normalizedPath))) {
            matchedLanguages.push(language);
        }
    }

    assert(matchedLanguages.length <= 1, `path matched multiple languages: ${normalizedPath}, languages: ${matchedLanguages.join(", ")}`);
    if (matchedLanguages.length <= 0) {
        let languageCode = getLanguageLikePathCode(normalizedPath);
        let configuredLanguages = new Set([...config.builtinLanguages, ...config.languages].map((language) => language.toUpperCase()));
        if (languageCode && !configuredLanguages.has(languageCode)) {
            return { kind: "ignored", language: languageCode };
        }
        return { kind: "common" };
    }

    let [language] = matchedLanguages;
    if (config.ignoreLanguages.has(language)) {
        return { kind: "ignored", language };
    }
    return { kind: "language", language };
}
