import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";

import { VALID_LANGS } from "../Define";

// 翻译表拆分工具，从1 vs N语言的单个表，输出到 1 vs 1的N个表
// （需要保证输入路径为正确的xlsx文件、输出文件为正确存在的文件夹）

/** 表头固定列数（excel的行列从1开始） */
const HEADFIXED_COLUMN_COUNT = 2;
/** key所在列 */
const KEY_COLUMN = 1;
/** id所在行数4 */
const HEAD_ID_ROW = 4;
/**
 * 表头信息
 */
const XLSX_HEADER_CELLS = [
    ["key"],
    ["string", "string", "string"],
    ["序号", "简体中文", "英文"],
    ["id", "raw", "EN_US"],
];
/**
 * xlsx翻译文件拆分到文件夹中生成各语言的xlsx文件
 * @param inputFile
 * @param outputFile
 */
export async function splitTranslateFileToEach(inputFile: string, outputFile?: string) {
    // 检查输入路径是否正确
    checkIfPathCorrect(inputFile, ".xlsx");

    outputFile = outputFile || path.join(path.dirname(inputFile), path.basename(inputFile, path.extname(inputFile)));
    if (!fs.existsSync(outputFile)) fs.mkdirSync(outputFile, { recursive: true });

    // 从文件读表
    const sourceWorkbook = new ExcelJS.Workbook();
    await sourceWorkbook.xlsx.readFile(inputFile);
    // 获取工作簿中的第一个工作表（索引 0）
    const sourceSheet = sourceWorkbook.worksheets[0];
    // 检查文件内容，剔除不合法数据
    checkContent(sourceSheet);
    // 获取总列数
    const columnCount = sourceSheet.columnCount;

    // 从第3列开始处理每一列
    for (let colIndex = HEADFIXED_COLUMN_COUNT + 1; colIndex <= columnCount; colIndex++) {
        await createSplitFile(sourceSheet, colIndex, outputFile, inputFile);
    }
}
/**
 * 检查文件内容正确性
 * @param sourceSheet
 */
function checkContent(sourceSheet: ExcelJS.Worksheet) {
    // 检查表头是否不匹配
    checkInputExcelHeaders(sourceSheet);

    // 检查行数据，保证（第一列key唯一）（任何单元不存在空数据）
    checkRowContent(sourceSheet);
}
/**
 * 检查表头是否一致
 * @param sheet
 */
function checkInputExcelHeaders(sheet: ExcelJS.Worksheet) {
    // 1. 遍历预期表头的每一行
    for (let rowIndex = 0; rowIndex < XLSX_HEADER_CELLS.length; rowIndex++) {
        const expectedRow = XLSX_HEADER_CELLS[rowIndex];
        // Excel的行索引是从1开始的，所以要加1
        const actualRow = sheet.getRow(rowIndex + 1);
        // 2. 遍历当前行的每一列
        for (let colIndex = 0; colIndex < expectedRow.length; colIndex++) {
            const expectedText = expectedRow[colIndex];
            // Excel的列索引是从1开始的，所以要加1
            // 使用 .text 可以获取单元格的显示文本，比 .Text 更可靠,Text可能是公式
            const actualText = actualRow.getCell(colIndex + 1).text;
            // 3. 对比预期值和实际值
            if (actualText !== expectedText) {
                console.error(
                    `错误：表头不匹配！` +
                        `[${rowIndex + 1}]行[${colIndex + 1}]列` +
                        `预期值:'${expectedText}', 实际值:'${actualText}'`,
                );
            }
        }
    }
}
/**
 * 检查行数据，保证（第一列key唯一）（任何单元不存在空数据）
 * @param sheet
 */
function checkRowContent(sheet: ExcelJS.Worksheet) {
    const keySet = new Set<string>();
    // 假设用栈存储需要删除的行索引（行号从 1 开始）
    const deleteStack: number[] = [];
    for (let rowIndex = HEAD_ID_ROW + 1; rowIndex <= sheet.rowCount; rowIndex++) {
        let isInvalidRow = false;
        for (let columnIndex = 1; columnIndex <= sheet.columnCount; columnIndex++) {
            const actualText = sheet.getRow(rowIndex).getCell(columnIndex).text;
            // 如果是第一列检查是否是重复key，是则打印并标记删除
            if (columnIndex === KEY_COLUMN) {
                if (!keySet.has(actualText)) {
                    keySet.add(actualText);
                } else {
                    isInvalidRow = true;
                    console.error(`发现重复key:[${actualText}]--位置：${rowIndex} 行${KEY_COLUMN}列`);
                }
            }
            // if (isInvalidCellText(actualText)) {
            // isInvalidRow = true;
            //     console.error(`非法单元格内容:[${actualText}]--位置：${rowIndex} 行${columnIndex}列`);
            // }
        }
        if (isInvalidRow) {
            deleteStack.push(rowIndex);
            // console.error(`[${rowIndex}]行存在不合法数据，将在新表中剔除`);
        }
    }
    while (deleteStack.length > 0) {
        const deleteRowIndex = deleteStack.pop();
        if (deleteRowIndex === undefined) continue;
        sheet.spliceRows(deleteRowIndex, 1);
    }
}
/**
 * 是否是不合法的单元格
 * @param actualText
 * @returns
 */
function isInvalidCellText(actualText: string): boolean {
    if (actualText === "") {
        return true;
    }
    return false;
}

/**
 * 检查文件路径以及拓展名正确性
 * @param filePath 文件路径
 * @param extName 想检查的拓展名
 */
function checkIfPathCorrect(filePath: string, extName?: string) {
    try {
        if (extName !== undefined) {
            // 1.1 检查路径是否存在
            fs.accessSync(filePath);
            // 1.2 检查路径是否指向一个文件（而不是目录）
            const stats = fs.statSync(filePath);
            if (!stats.isFile()) {
                console.error(`错误：'${filePath}' 是一个目录，而不是文件。`);
                process.exit(1);
            }
            // 1.3 检查文件扩展名是否匹配（不区分大小写）
            const fileExtension = path.extname(filePath).toLowerCase();
            if (fileExtension !== extName.toLowerCase()) {
                console.error(`错误：文件格式不正确。期望是 '${extName}'，但实际是 '${fileExtension}'。`);
                process.exit(1);
            }
        } else {
            // 检查目录是否存在，如果不存在则创建
            checkAndCreateDirectory(filePath);
        }
        // 如果所有检查都通过，函数正常返回
    } catch (err) {
        // 捕获所有其他可能的错误，如权限问题等
        console.error(`错误：处理路径 '${filePath}' 时发生错误:`, (err as Error).message);

        process.exit(1);
    }
}
function checkAndCreateDirectory(filePath: string) {
    try {
        if (!fs.existsSync(filePath)) {
            // fs.mkdirSync 可以递归创建目录（包括父目录）
            fs.mkdirSync(filePath, { recursive: true });
            // console.log(`信息：目录 '${filePath}' 不存在，已自动创建。`);
        } else {
            // 2.2 如果目录已存在，确认它确实是一个目录
            const stats = fs.statSync(filePath);
            if (!stats.isDirectory()) {
                console.error(`错误：'${filePath}' 已存在，但它不是一个目录。`);
                process.exit(1);
            }
        }
    } catch (err) {
        // 捕获所有其他可能的错误，如权限问题等
        console.error(`错误：处理路径 '${filePath}' 时发生错误:`, (err as Error).message);
        process.exit(1);
    }
}
/**
 * 检查id是否在语言运行时配置中
 * @param sourceSheet
 * @param columnIndex
 * @returns
 */
function checkSplitSheetCorrect(sourceSheet: ExcelJS.Worksheet, columnIndex: number): string {
    let idName = sourceSheet.getCell(HEAD_ID_ROW, columnIndex).text;
    if (!VALID_LANGS.includes(idName)) {
        console.error(`分表失败：发现非法 id  '${idName}' 在第${columnIndex}列 第${HEAD_ID_ROW}行`);
        process.exit(1);
    }
    return idName;
}
/**
 * 创建各语言分表
 * @param sourceSheet
 * @param columnIndex
 * @param outputDir
 */
async function createSplitFile(
    sourceSheet: ExcelJS.Worksheet,
    columnIndex: number,
    outputDir: string,
    inputFileName: string,
): Promise<void> {
    const newWorkbook = new ExcelJS.Workbook();
    const newSheet = newWorkbook.addWorksheet("Sheet1");
    // 检查第四行文本是否正确，不属于语言运行时配置则报错
    const sheetIdName = checkSplitSheetCorrect(sourceSheet, columnIndex);
    // 创建文件夹：依照目标列第四行id创建分表文件夹，若第四行内容不属于语言运行时配置则报错
    const outputDirector = path.join(outputDir, sheetIdName);
    checkAndCreateDirectory(outputDirector);
    // 创建分表名，在原表名前加 {sheetIdName}~
    const outputFileName = `${sheetIdName}~${path.basename(inputFileName, path.extname(inputFileName))}.xlsx`;
    const outputPath = path.join(outputDirector, outputFileName);
    // 复制数据
    let newRowIndex = 1;
    for (let rowNum = 1; rowNum <= sourceSheet.rowCount; rowNum++) {
        const sourceCell = sourceSheet.getCell(rowNum, columnIndex);
        const targetCellValue = rowNum === HEAD_ID_ROW ? "translate" : sourceCell.value;
        if (rowNum !== 1 && !targetCellValue) continue;

        const newRow = newSheet.getRow(newRowIndex++);
        // 复制前两列
        for (let colNum = 1; colNum <= HEADFIXED_COLUMN_COUNT; colNum++) {
            const sourceCell = sourceSheet.getCell(rowNum, colNum);
            const targetCell = newRow.getCell(colNum);
            targetCell.value = sourceCell.value;
            // 复制样式
            copyCellStyle(sourceCell, targetCell);
        }
        // 复制当前列作为第4列
        const targetCell = newRow.getCell(HEADFIXED_COLUMN_COUNT + 1);
        targetCell.value = targetCellValue;
        // 复制样式
        copyCellStyle(sourceCell, targetCell);
        // 提交行更改
        newRow.commit();
    }
    // 保存文件
    await newWorkbook.xlsx.writeFile(outputPath);
    console.log(`已生成文件: ${outputFileName}.xlsx`);
}
/**
 * 创建各语言分表
 * @param sourceCell
 * @param targetCell
 */
function copyCellStyle(sourceCell: ExcelJS.Cell, targetCell: ExcelJS.Cell): void {
    if (sourceCell.style) {
        targetCell.style = { ...sourceCell.style };
    }
}
