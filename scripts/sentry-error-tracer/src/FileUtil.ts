import AdmZip from "adm-zip";
import axios from "axios";
import assert from "node:assert";
import child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { Logger } from "./Logger";

export async function downloadFile(url: string, filePath: string) {
    if (fs.existsSync(filePath)) {
        Logger.debug(`文件已存在：${filePath}，跳过下载`);
        return;
    }

    const response = await axios.get(url, { responseType: "stream" });
    assert(response.status === 200, `sourcemap 文件下载失败，状态码：${response.status}`);

    Logger.debug(`创建下载任务：${url} => ${filePath}`);

    const folderPath = path.dirname(filePath);
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);
    let receivedBytes = 0;
    const totalBytes = response.headers["content-length"];
    response.data.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        process.stdout.write(`\r下载进度：${receivedBytes}/${totalBytes} bytes, url: ${url}`);
    });
    await new Promise<void>((resolve, reject) => {
        writer.on("finish", () => {
            process.stdout.write(`\n`);
            Logger.debug(`下载完成，文件大小：${receivedBytes} bytes`);
            Logger.splitLine();
            resolve();
        });
        writer.on("error", () => {
            reject(new Error("下载失败"));
        });
    });
}

export async function unzipFile(zipFilePath: string, targetPath?: string) {
    targetPath = path.dirname(zipFilePath) + "/" + path.basename(zipFilePath, ".zip");
    Logger.debug(`解压文件：${zipFilePath} => ${targetPath}`);
    try {
        if (fs.existsSync(targetPath)) fs.rmSync(targetPath, { recursive: true });
        new AdmZip(zipFilePath).extractAllTo(targetPath, true);
        Logger.debug(`解压完成`);
    } catch (e) {
        Logger.debug(`解压失败：${e}`);
    }
    return targetPath;
}

export async function saveAndOpenFile(content: string, filePath: string) {
    try {
        if (!fs.existsSync(path.dirname(filePath))) fs.mkdirSync(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, content);
        Logger.info(`解析结果已保存至：${filePath}`);
        child_process.exec(`code ${filePath}`);
    } catch (e) {
        Logger.debug(`保存文件失败：${e}`);
    }
}
