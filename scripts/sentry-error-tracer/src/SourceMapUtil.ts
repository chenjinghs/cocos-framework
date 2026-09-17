/* eslint-disable @typescript-eslint/no-unused-expressions */
import fs from "fs";
import path from "path";
import { MappedPosition, SourceMapConsumer } from "source-map";

import { CONFIG, EPlatform, ERuntime, SOURCE_RELOCATE_MAPPING, SOURCEMAP_RELOCATE_MAPPING, TS_PROJECT_ROOT } from "./Define";
import { Logger } from "./Logger";

export function lineSlicer(text: string | null, line: number, column: number): string {
    if (text === null) return ""; // sourcemap.sourcesContent is empty
    let opts: any = {};
    const delimiter = opts.delimiter || "\n";
    const before = opts.before || opts.context || 0;
    const after = opts.after || opts.context || 0;
    const lines = text.split(delimiter);
    const begin = Math.max(0, line - before - 1);
    const end = Math.min(line + after - 1, lines.length - 1);
    const slice = lines.slice(begin, end + 1);
    if (opts.marker) slice.splice(line - begin, 0, "^".padStart(column + 1));
    return slice.join(delimiter);
}

export function getOriginalPositionFor(smc: SourceMapConsumer, line: number, column: number) {
    const mapPos = { line, column };
    const pos = smc.originalPositionFor(mapPos);
    if (!pos.source) {
        throw new Error("Mapping not found");
    }
    return pos;
}

export function getSourceContentFor(smc: SourceMapConsumer, pos: MappedPosition) {
    try {
        const src = smc.sourceContentFor(pos.source);
        return lineSlicer(src, pos.line, pos.column);
    } catch (error) {
        Logger.debug(`getSourceContentFor error: ${error instanceof Error ? error.message : error?.toString()}`);
        return undefined;
    }
}

export async function parseStacktrace(stacktrace: string, sourcemapPath: string, runtime: ERuntime, platform: EPlatform) {
    const output: string[] = [];
    const lines = stacktrace.split("\n");
    for (const lineText of lines) {
        try {
            const match = lineText.match(/(\w+?:\/\/.*?\.js):(\d+):(\d+)/);
            if (!match) throw new Error("文件路径匹配失败");
            const [_, url, line, column] = match;

            // 还原 sourcemap 路径
            let mapPath = `${sourcemapPath}/${url}.map`;
            Object.entries(SOURCEMAP_RELOCATE_MAPPING[runtime][platform]).forEach(([key, value]) => (mapPath = mapPath.replace(key, value)));

            const smc = await new SourceMapConsumer(fs.readFileSync(mapPath, "utf8"));
            const pos = getOriginalPositionFor(smc, Number(line), Number(column));
            if (pos.source === null) throw new Error("未找到对应映射");

            let sourceConfig = SOURCE_RELOCATE_MAPPING[runtime];
            let sourcePath = pos.source.replace(sourceConfig.trimPrefix, "");
            sourcePath = sourceConfig.isRelativeToMap ? path.join(mapPath, "..", sourcePath) : sourcePath;
            sourcePath = CONFIG.FULL_LOCAL_PATH ? path.resolve(TS_PROJECT_ROOT, sourcePath) : sourcePath.replace(TS_PROJECT_ROOT, "");
            sourcePath = sourcePath.replace(/\\/g, "/");

            const sourceCode = getSourceContentFor(smc, pos as MappedPosition)?.trim();
            output.push(`\x1B[33m    at${pos.name ? ` ${pos.name}` : ""} (${sourcePath}:${pos.line}:${pos.column})\x1B[0m${sourceCode ? `\n        => ${sourceCode}` : ""}`);
        } catch (error) {
            Logger.debug(`parseStacktrace error: ${error instanceof Error ? error.message : error?.toString()}, lineText: ${lineText}`);
            output.push(lineText);
        }
    }
    return output.join("\n");
}
