import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

export function buildDefaultOutputPath(inputPath: string): string {
    const extension = extname(inputPath);
    const stem = extension ? basename(inputPath, extension) : basename(inputPath);
    return join(dirname(inputPath), `${stem}.log`);
}

export function createOutputRoot(parentDir: string, name: string): string {
    const outputRoot = join(parentDir, `${safeFilePart(name)}-${formatDateForFileName(new Date())}`);
    mkdirSync(outputRoot, { recursive: true });
    return outputRoot;
}

export function getDownloadsDir(): string {
    return join(homedir(), "Downloads");
}

export function buildLogFileName(uid: string, eventId: string, eventTime: string, attachmentName: string): string {
    const attachmentType = attachmentName === "log.enc.bak" ? "bak" : "raw";
    return `${safeFilePart(uid)}-${safeFilePart(eventId)}-${formatDateForFileName(new Date(eventTime))}-${attachmentType}.log`;
}

export function makeUniquePath(outputRoot: string, fileName: string): string {
    const parsed = fileName.match(/^(.*)(\.log)$/);
    const stem = parsed?.[1] ?? fileName;
    const extension = parsed?.[2] ?? "";
    let candidate = join(outputRoot, fileName);
    let index = 2;
    while (existsSync(candidate)) {
        candidate = join(outputRoot, `${stem}-${index}${extension}`);
        index += 1;
    }

    return candidate;
}

export function resolvePath(value: string): string {
    return resolve(stripWrappingQuotes(value));
}

export function stripWrappingQuotes(value: string): string {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
            return trimmed.slice(1, -1).trim();
        }
    }

    return trimmed;
}

function formatDateForFileName(date: Date): string {
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    const parts = [
        safeDate.getFullYear(),
        safeDate.getMonth() + 1,
        safeDate.getDate(),
        safeDate.getHours(),
        safeDate.getMinutes(),
        safeDate.getSeconds(),
    ];

    return `${parts[0]}-${pad(parts[1])}-${pad(parts[2])}-${pad(parts[3])}-${pad(parts[4])}-${pad(parts[5])}`;
}

function pad(value: number): string {
    return value.toString().padStart(2, "0");
}

function safeFilePart(value: string): string {
    return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}
