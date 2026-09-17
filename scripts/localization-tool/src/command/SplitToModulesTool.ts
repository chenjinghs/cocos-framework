import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

import { DEFAULT_LANG } from "../Define";

interface KeyData {
    key: string;
    raw: string;
    translate: string;
    isClientOnly: boolean;
}

/**
 * 从 CSV 目录扫描所有 key 及其 client_only 状态
 */
function scanAllKeysFromCsv(sourceCsvDir: string): Map<string, KeyData> {
    const allKeys = new Map<string, KeyData>();

    if (!fs.existsSync(sourceCsvDir)) {
        console.error(`错误: CSV 源目录不存在: ${sourceCsvDir}`);
        process.exit(1);
    }

    const files = fs.readdirSync(sourceCsvDir).filter((f) => f.endsWith(".csv") && !f.startsWith("~$"));

    if (files.length === 0) {
        console.error(`错误: CSV 源目录中没有找到 .csv 文件: ${sourceCsvDir}`);
        process.exit(1);
    }

    for (const file of files) {
        const csvPath = path.join(sourceCsvDir, file);
        const content = fs.readFileSync(csvPath, "utf-8");
        const lines = content.split("\n");

        // 第一行判断 client_only
        const firstLine = lines[0] || "";
        const isClientOnly = firstLine.includes("client_only");

        // 从第5行开始读取 key
        for (let i = 4; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const key = line.split(",")[0]?.trim().replace(/^"|"$/g, "");
            if (key && !allKeys.has(key)) {
                allKeys.set(key, {
                    key,
                    raw: "",
                    translate: "",
                    isClientOnly,
                });
            }
        }
    }

    console.log(`从 CSV 扫描到 ${allKeys.size} 个 key`);
    return allKeys;
}

/**
 * 获取所有需要处理的语言目录
 */
function getLanguageDirs(localizationDir: string): string[] {
    if (!fs.existsSync(localizationDir)) {
        console.error(`错误: localization 目录不存在: ${localizationDir}`);
        process.exit(1);
    }

    const dirs = fs.readdirSync(localizationDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== DEFAULT_LANG)
        .map((d) => d.name);

    return dirs;
}

/**
 * 读取合并的翻译表（仅 translated）
 */
async function loadMergedTranslation(mergedFile: string): Promise<Map<string, { raw: string; translate: string }>> {
    if (!fs.existsSync(mergedFile)) {
        console.error(`错误: 合并翻译表不存在: ${mergedFile}`);
        process.exit(1);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(mergedFile);
    const sheet = workbook.worksheets[0];

    const translations = new Map<string, { raw: string; translate: string }>();

    for (let row = 5; row <= sheet.rowCount; row++) {
        const key = sheet.getCell(row, 1).text;
        const raw = sheet.getCell(row, 2).text;
        const translate = sheet.getCell(row, 3).text;

        if (key) {
            translations.set(key, { raw: raw || "", translate: translate || "" });
        }
    }

    return translations;
}

/**
 * 生成两个文件：
 * - {lang}~translated.xlsx (clientOnly key, 带 #client_only 标记)
 * - {lang}~translated~server.xlsx (非 clientOnly key, server 端用)
 */
async function generateSplitFiles(
    allKeys: Map<string, KeyData>,
    translations: Map<string, { raw: string; translate: string }>,
    outputDir: string,
    targetLang: string,
) {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // 分类 key - 只处理 translated.xlsx 中存在的 key
    const clientOnlyKeys: KeyData[] = [];
    const normalKeys: KeyData[] = [];

    for (const [key, trans] of translations) {
        const keyData = allKeys.get(key);
        if (!keyData) {
            // key 不在 CSV 中（理论上不应该发生），跳过
            console.warn(`  警告: key '${key}' 在 CSV 中不存在，跳过`);
            continue;
        }

        const data: KeyData = {
            key,
            raw: trans.raw || "",
            translate: trans.translate || "",
            isClientOnly: keyData.isClientOnly,
        };

        if (keyData.isClientOnly) {
            clientOnlyKeys.push(data);
        } else {
            normalKeys.push(data);
        }
    }

    // 生成 clientOnly 文件: {lang}~translated.xlsx
    if (clientOnlyKeys.length > 0) {
        await createExcelFile(
            outputDir,
            `${targetLang}~translated.xlsx`,
            "key#client_only",
            clientOnlyKeys,
        );
        console.log(`  生成: ${targetLang}~translated.xlsx (${clientOnlyKeys.length} 条, clientOnly)`);
    }

    // 生成 server 文件: {lang}~translated~server.xlsx
    if (normalKeys.length > 0) {
        await createExcelFile(
            outputDir,
            `${targetLang}~translated~server.xlsx`,
            "key",
            normalKeys,
        );
        console.log(`  生成: ${targetLang}~translated~server.xlsx (${normalKeys.length} 条, server)`);
    }
}

/**
 * 创建单个 Excel 文件
 */
async function createExcelFile(
    outputDir: string,
    fileName: string,
    keyHeader: string,
    data: KeyData[],
) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");

    // 写入表头
    const headerRows = [
        [keyHeader, "", ""],
        ["string", "#", "string"],
        ["id", "原始文本", "翻译文本"],
        ["id", "raw", "translate"],
    ];

    for (let r = 0; r < headerRows.length; r++) {
        const row = sheet.getRow(r + 1);
        for (let c = 0; c < headerRows[r].length; c++) {
            row.getCell(c + 1).value = headerRows[r][c];
        }
    }

    // 写入数据
    for (let i = 0; i < data.length; i++) {
        const { key, raw, translate } = data[i];
        const row = sheet.getRow(5 + i);
        row.getCell(1).value = key;
        row.getCell(2).value = raw;
        row.getCell(3).value = translate;
    }

    const outputPath = path.join(outputDir, fileName);
    await workbook.xlsx.writeFile(outputPath);
}

/**
 * 处理单个语言
 */
async function processLanguage(
    allKeys: Map<string, KeyData>,
    lang: string,
    localizationDir: string,
): Promise<boolean> {
    const langDir = path.join(localizationDir, lang);
    const translatedFile = path.join(langDir, `${lang}~translated.xlsx`);

    if (!fs.existsSync(translatedFile)) {
        console.warn(`\n警告: 跳过 ${lang}，未找到翻译文件: ${translatedFile}`);
        return false;
    }

    console.log(`\n>>> 正在处理语言: ${lang}`);
    console.log(`  读取: ${lang}~translated.xlsx`);

    const translations = await loadMergedTranslation(translatedFile);
    console.log(`  加载了 ${translations.size} 条翻译数据`);

    // 先删除源文件（避免与新生成的 clientOnly 文件冲突）
    try {
        fs.unlinkSync(translatedFile);
        console.log(`  删除源文件: ${lang}~translated.xlsx`);
    } catch (err) {
        console.warn(`  警告: 删除源文件失败: ${translatedFile}`, (err as Error).message);
    }

    // 再生成两个新文件
    await generateSplitFiles(allKeys, translations, langDir, lang);

    return true;
}

/**
 * 批量拆分所有语言的翻译表
 */
export async function splitToModules(
    sourceCsvDir: string,
    localizationDir: string,
) {
    console.log("=== 拆分翻译表到 translated/translated~server 文件 ===");
    console.log(`CSV 源结构: ${sourceCsvDir}`);
    console.log(`Localization 目录: ${localizationDir}`);
    console.log("");

    // 1. 从 CSV 扫描所有 key 及其 client_only 状态（只需要做一次）
    const allKeys = scanAllKeysFromCsv(sourceCsvDir);

    // 2. 获取所有需要处理的语言目录
    const languages = getLanguageDirs(localizationDir);
    console.log(`发现语言: ${languages.join(", ")}`);
    console.log("");

    if (languages.length === 0) {
        console.log("没有找到需要处理的语言");
        return;
    }

    // 3. 逐个处理每个语言
    let successCount = 0;
    for (const lang of languages) {
        const success = await processLanguage(allKeys, lang, localizationDir);
        if (success) successCount++;
    }

    console.log("\n=== 拆分完成 ===");
    console.log(`成功处理: ${successCount}/${languages.length} 个语言`);
}
