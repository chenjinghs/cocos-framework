import ExcelJS from "exceljs";
import { parse } from "json-util";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_LANG, type ILocalizationPaths } from "../Define.js";

// translated 文件使用普通 key 表头
const XLSX_HEADER_CELLS = [
    ["key"],
    ["string", "#", "string"],
    ["id", "原始文本", "翻译文本"],
    ["id", "raw", "translate"],
];

// untranslated 和 nontranslatable 文件使用 client_only 表头
const XLSX_HEADER_CELLS_CLIENT_ONLY = [
    ["key#client_only"],
    ["string", "#", "string"],
    ["id", "原始文本", "翻译文本"],
    ["id", "raw", "translate"],
];

async function loadDict(paths: ILocalizationPaths, lang: string) {
    const file = path.join(paths.translationSourceDir, `${lang}.json`);
    if (!fs.existsSync(file)) {
        console.error(`[Error] Translation source for language ${lang} does not exist, please gen-config first.`);
        return new Map<string, string>();
    }
    const content = await fs.promises.readFile(file, "utf-8");
    const dist = parse(content) as Map<string, string>;
    const sortedDist = new Map([...dist.entries()].sort(([a], [b]) => a.localeCompare(b)));
    return sortedDist;
}

async function loadTranslationLanguages(paths: ILocalizationPaths) {
    const entries = await fs.promises.readdir(paths.translationOutputDir, { withFileTypes: true });
    return entries
        .filter(
            (entry) =>
                entry.isDirectory() && fs.existsSync(path.join(paths.translationSourceDir, `${entry.name}.json`)),
        )
        .map((entry) => entry.name)
        .filter((lang) => lang !== DEFAULT_LANG)
        .sort((a, b) => a.localeCompare(b));
}

async function translateDict(paths: ILocalizationPaths, lang: string, defaultDict: Map<string, string>) {
    const dict = await loadDict(paths, lang);
    const translatedBook = new ExcelJS.Workbook();
    const untranslatedBook = new ExcelJS.Workbook();
    const nonTranslatableBook = new ExcelJS.Workbook();
    const translatedSheet = translatedBook.addWorksheet(`${lang}~translated`);
    const untranslatedSheet = untranslatedBook.addWorksheet(`${lang}~untranslated`);
    const nonTranslatableSheet = nonTranslatableBook.addWorksheet(`${lang}~nontranslatable`);

    // 插入表头：translated 用普通表头，untranslated 和 nontranslatable 用 client_only 表头
    XLSX_HEADER_CELLS.forEach((cells) => translatedSheet.addRow(cells));
    XLSX_HEADER_CELLS_CLIENT_ONLY.forEach((cells) => {
        untranslatedSheet.addRow(cells);
        nonTranslatableSheet.addRow(cells);
    });

    // 插入翻译内容
    for (const [key, defaultValue] of defaultDict) {

        // ascii 范围内的字符，不需要翻译放到 nontranslatableSheet
        if (/^[\x00-\x7F]*$/.test(defaultValue)) {
            nonTranslatableSheet.addRow([key, defaultValue, defaultValue]);
            continue;
        }

        const value = dict.get(key);
        if (value) translatedSheet.addRow([key, defaultValue, value]);
        else if (defaultValue) untranslatedSheet.addRow([key, defaultValue]);
    }

    // 保存文件
    const languageFolder = path.join(paths.translationOutputDir, lang);
    await Promise.all([
        fs.promises.mkdir(languageFolder, { recursive: true }),
        translatedBook.xlsx.writeFile(path.join(languageFolder, `${translatedSheet.name}.xlsx`)),
        untranslatedBook.xlsx.writeFile(path.join(languageFolder, `${untranslatedSheet.name}.xlsx`)),
        nonTranslatableBook.xlsx.writeFile(path.join(languageFolder, `${nonTranslatableSheet.name}.xlsx`)),
    ]);


    console.log(
        `Translate ${lang} finished，Total keys: ${defaultDict.size}, Translated: ${
            translatedSheet.rowCount - XLSX_HEADER_CELLS.length
        }, Untranslated: ${untranslatedSheet.rowCount - XLSX_HEADER_CELLS.length}, Non-translatable: ${
            nonTranslatableSheet.rowCount - XLSX_HEADER_CELLS.length
        }.`,
    );
}

export async function translate(paths: ILocalizationPaths, langs?: string[]) {
    const targetLangs = langs ?? (await loadTranslationLanguages(paths));
    if (targetLangs.length === 0) {
        throw new Error(`No translation source found in ${paths.translationSourceDir}. Please run export-data-table first.`);
    }
    for (const targetLang of targetLangs) {
        if (targetLang === DEFAULT_LANG) continue;
        console.log(`start translate for language: ${targetLang}`);
        const defaultDict = await loadDict(paths, DEFAULT_LANG);
        await translateDict(paths, targetLang, defaultDict);
        console.log("[OK] Translation completed successfully.");
    }
}
