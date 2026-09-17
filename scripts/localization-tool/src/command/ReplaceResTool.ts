import * as fs from "fs/promises";
import * as path from "path";

import type { ILocalizationPaths } from "../Define.js";

async function copyAndBackupFilesTo(paths: ILocalizationPaths, src: string, dest: string, withBackup: boolean): Promise<void> {
    let isFileExist = await fs.stat(dest).catch(() => undefined);
    if (!isFileExist) {
        console.log(`File does not exist at destination: ${dest}, no need to copy.`);
        return;
    }
    if (withBackup) {
        let backupDir = path.dirname(path.join(paths.backupDir, path.relative(paths.projectRoot, dest)));
        await fs.mkdir(backupDir, { recursive: true });
        let backupPath = path.join(backupDir, path.basename(src));
        console.log(`Backing up existing file: ${dest} to ${backupPath}`);
        await fs.copyFile(dest, backupPath).catch(() => console.log(`No existing file to backup at: ${dest}`));
    }
    console.log(`Copying file: ${src} to ${dest}`);
    await fs.copyFile(src, dest).catch(() => console.error(`Failed to copy file from ${src} to ${dest}`));
}

async function copyFilesTo(paths: ILocalizationPaths, sourceDir: string, targetDir: string, withBackup: boolean): Promise<void> {
    // 检查源目录是否存在
    await fs.access(sourceDir).catch(() => {
        throw new Error(`源目录不存在: ${sourceDir}`);
    });

    // 确保目标目录存在
    await fs.mkdir(targetDir, { recursive: true });

    const entries = await fs.readdir(sourceDir, { withFileTypes: true });

    // 遍历所有条目
    await Promise.all(
        entries.map(async (entry) => {
            const srcPath = path.join(sourceDir, entry.name);
            const destPath = path.join(targetDir, entry.name);

            if (entry.isDirectory()) {
                // 递归处理子目录
                await copyFilesTo(paths, srcPath, destPath, withBackup);
            } else if (entry.isFile()) {
                // 拷贝文件（覆盖同名文件）
                await copyAndBackupFilesTo(paths, srcPath, destPath, withBackup);
            }
        }),
    );
}

export async function replaceRes(paths: ILocalizationPaths, targetLang: string) {
    await restoreRes(paths);

    console.log(`start replace localization resource for language: ${targetLang}`);
    const sourceDir = path.join(paths.localizationRootDir, targetLang);
    const targetDir = paths.projectRoot;
    await copyFilesTo(paths, sourceDir, targetDir, true);
    console.log("[OK] Resource replacement completed successfully.");
}

export async function restoreRes(paths: ILocalizationPaths) {
    console.log(`start restore localization resource from backup`);
    const sourceDir = paths.backupDir;
    const targetDir = paths.projectRoot;
    if (!(await fs.stat(sourceDir).catch(() => false))) {
        console.warn(`[WARN] Backup directory does not exist: ${sourceDir}, nothing to restore.`);
        return;
    }
    await copyFilesTo(paths, sourceDir, targetDir, false);
    await fs.rm(paths.backupDir, { recursive: true, force: true });
    console.log("[OK] Resource restoration completed successfully.");
}
