import { program } from "commander";

import { ProtoExportCli } from "./ProtoExportCli";
import { IExportOptions } from "./IncrementalExportState";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const PACKAGE_INFO = require("../package.json");

program
    .name(PACKAGE_INFO.name)
    .description(PACKAGE_INFO.description)
    .version(PACKAGE_INFO.version, "-v, --version", "output the current version")
    .requiredOption("-p,--protoRootPath <path>", "root path of all proto files")
    .requiredOption("-s,--sourcePath <path>", "source proto scan path")
    .requiredOption("-ts,--targetTsPath <path>", "output ts folder")
    .requiredOption("-lua,--targetLuaPath <path>", "output lua folder")
    .option("--monoProtoPath <path>", "output mono proto file")
    .option("--bundleJsPath <path>", "output pb-bundle.js")
    .option("--bundleDtsPath <path>", "output pb-bundle.d.ts")
    .option("--distBundleJsPath <path>", "output minified pb-bundle.js")
    .option("--protocolRegisterModule <module>", "module exporting registerC2SProtocol/registerS2CProtocol; omit to skip registration code")
    .option("--incrementCachePath <path>", "increment cache file (default: proto-export-increment-cache.json next to bundle output)")
    .option("-i,--ignorePaths <path...>", "ignored directories")
    .option("--convertAllNumber64To <typeName>", "convert 64-bit int fields to type", "bigint")
    .option("--convertPBMapToJSMap", "use Map instead of plain object for proto maps")
    .option("--minify", "minify dist pb-bundle.js with uglify-js")
    .option("--increment", "skip export when nothing changed")
    .parse();

ProtoExportCli.export(program.opts<IExportOptions>()).catch((e) => {
    console.error(e);
    process.exit(1);
});
