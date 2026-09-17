import { program, type OptionValues } from "commander";

import { genConfig } from "./command/GenConfigTool.js";
import { replaceRes, restoreRes } from "./command/ReplaceResTool.js";
import { splitToModules } from "./command/SplitToModulesTool.js";
import { splitTranslateFileToEach } from "./command/TranslateFileSplitTool.js";
import { translate } from "./command/TranslateTool.js";
import { loadValidLangs, resolvePaths } from "./Define.js";

const PROJECT_ROOT_OPTION = "--project-root <path>";
const PROJECT_ROOT_DESCRIPTION = "消费项目根目录(包含 ProjectSettings、ExternalConfig 等),默认当前工作目录";

function createContext(opts: OptionValues) {
    const paths = resolvePaths(opts.projectRoot ?? ".");
    const validLangs = loadValidLangs(paths.languageRuntimeConfigPath);
    return { paths, validLangs };
}

function validateLang(validLangs: string[], lang: string) {
    if (!validLangs.includes(lang)) {
        console.error(`[ERROR] Invalid language: ${lang}, please choose from: ${validLangs.join(", ")}`);
        process.exit(1);
    }
    return lang;
}

function validateLangs(validLangs: string[], langsStr: string) {
    const langs = langsStr.split(",");
    for (const lang of langs) {
        validateLang(validLangs, lang);
    }
    return langs;
}

// 基于配置表导出后的结果进行 diff，生成已翻译和未翻译的列表
program
    .command("translate")
    .argument("[langs]", "language")
    .description("translate to specified language")
    .option(PROJECT_ROOT_OPTION, PROJECT_ROOT_DESCRIPTION)
    .action((langsStr: string | undefined, opts: OptionValues) => {
        const { paths, validLangs } = createContext(opts);
        const langs = langsStr ? validateLangs(validLangs, langsStr) : undefined;
        return translate(paths, langs);
    });

// 打包前调用，做静态资源替换入包
program
    .command("replace-res")
    .argument("<lang>", "language")
    .description("replace resource for specified language")
    .option(PROJECT_ROOT_OPTION, PROJECT_ROOT_DESCRIPTION)
    .action((lang: string, opts: OptionValues) => {
        const { paths, validLangs } = createContext(opts);
        validateLang(validLangs, lang);
        return replaceRes(paths, lang);
    });

// 恢复之前替换资源时做的备份
program
    .command("restore-res")
    .option(PROJECT_ROOT_OPTION, PROJECT_ROOT_DESCRIPTION)
    .action((opts: OptionValues) => restoreRes(resolvePaths(opts.projectRoot ?? ".")));

// 配置完 language-runtime-config.json[project.languages] 后，通过该命令生成所有相关的配置文件
program
    .command("gen-config")
    .description("generate config for language-runtime-config.json[project.languages]")
    .option(PROJECT_ROOT_OPTION, PROJECT_ROOT_DESCRIPTION)
    .action((opts: OptionValues) => {
        const { paths, validLangs } = createContext(opts);
        return genConfig(paths, validLangs);
    });

/** 翻译表拆分至各语言单表 */
program
    .command("translate-file-split")
    .description("split translate files to each language")
    // 参数定义：
    .argument("<inputPath>", "配置文件路径")
    .argument("[outputPath]", "输出文件路径(没输入则默认输入路径)")
    .action(splitTranslateFileToEach);

/** 翻译表按模块拆分 */
program
    .command("split-to-modules")
    .description("split all translated files to module files using CSV structure as reference")
    .argument("<sourceCsvDir>", "source CSV directory (e.g., TempSaved/export-flow/csv/localization/ZH_CN)")
    .argument("<localizationDir>", "localization root directory (e.g., ExternalConfig/design-config/new_src/localization)")
    .action(splitToModules);

// prettier-ignore
program.name("localization-tool")
    .description("A tool to assist with localization tasks")
    .parse();
