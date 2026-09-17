/* eslint-disable @typescript-eslint/member-ordering */
import * as xlsx from "xlsx";
import * as yaml from "yaml";
import * as csv from "csv-parse/sync";

import { Constructor, getGlobalConfig } from "../data/Define";
import { Serializer, StringReader } from "../serializer";
import { ExportLogger } from "./ExportLogger";
import { newLocError } from "./Localization";
import { Registry } from "./Registry";
import { getErrorInfo, loadBinaryFileData, loadTextFileData } from "./Util";

// const Papaparse = require("papaparse");
const xlsxCalc = require("xlsx-calc");
xlsxCalc.import_functions(require("@formulajs/formulajs"));

export abstract class Loader {
    public extension = "";
    public static register<T extends Loader>(this: Constructor<T>, key: string) {
        Registry.get(Loader).register(this, key);
    }
    public static create(key: string, withDefaultLoader = true): Loader | undefined {
        let ret = Registry.get(Loader).create<Loader>(key);
        ret = ret ? ret : withDefaultLoader ? new DefaultStringLoader() : undefined;
        if (ret) ret.extension = key;
        return ret;
    }

    public loadRawDataObject<T = any>(file: string, config: unknown): Promise<T> {
        return this.loadRawDataObjectImp(file, config).catch((e: any) => {
            let ext = this.extension.startsWith(".") ? this.extension.slice(1) : this.extension;
            throw newLocError("load-raw-data-failed", { type: ext, file: file, error: getErrorInfo(e) });
        }) as Promise<T>;
    }

    protected abstract loadRawDataObjectImp(file: string, config: unknown): Promise<object>;
    public abstract createDataReader(): Serializer; // 感觉有点别扭，先凑合放这吧
}

// /////////////////////////////////////////////////////////////////////////////////
class YamlLoader extends Loader {
    protected async loadRawDataObjectImp(file: string, config: unknown) {
        let data = await loadTextFileData(file, config);
        return yaml.parse(data);
    }

    public createDataReader() {
        return new StringReader();
    }
}
YamlLoader.register(".yml");

// /////////////////////////////////////////////////////////////////////////////////
interface IExcelLoaderConfig {
    sheet?: string;
    // calcFormula?: boolean; // TODO: 临时补丁，开开XLSX_CALC会把好数据转错
}

class ExcelLoader extends Loader {
    protected async loadRawDataObjectImp(file: string, config: IExcelLoaderConfig) {
        let data = (await loadBinaryFileData(file, config)) as any;
        let workbook = xlsx.read(data, { sheets: config.sheet, bookDeps: true, cellFormula: true, sheetStubs: true });
        xlsxCalc(workbook);
        let worksheet = workbook.Sheets[workbook.SheetNames[0]];
        return xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    }

    public createDataReader() {
        return new StringReader();
    }
}
ExcelLoader.register(".xlsx");

// /////////////////////////////////////////////////////////////////////////////////
class TabLoader extends Loader {
    private static config = {
        skipEmptyLines: true,
        delimiter: "\t",
    };

    protected async loadRawDataObjectImp(file: string, config: unknown) {
        let data = await loadTextFileData(file, config);

        // let result = Papaparse.parse(data, TabLoader.config);
        // if (result.errors?.length > 0) {
        //     throw result.errors[0];
        // }
        // return this.removeEmptyValues(result.data);

        return this.parse(data);
    }

    public createDataReader() {
        return new StringReader();
    }

    private parse(data: string) {
        const EOF_REG = /\r?\n/;
        const DATA_TABLE_SPLIT_CHAR = "\t";

        let ret = new Array<Array<string>>();
        let lines = data.split(EOF_REG);
        lines.forEach((line, index) => {
            let normalizedLine = line.replace(/\\n/g, "\n");
            let values = normalizedLine.split(DATA_TABLE_SPLIT_CHAR) as any;
            let hasValue = false;

            // 删掉空数据
            for (let i = 0; i < values.length; ++i) {
                if (values[i].trim().length == 0) {
                    values[i] = undefined;
                } else hasValue = true;
            }

            if (hasValue) ret.push(values);
        });
        return ret;
    }

    private removeEmptyValues(data: Array<Array<any>>) {
        let values = data;
        for (let i = 0; i < values.length; ) {
            let hasValue = false;
            for (let j = 0; j < values[i].length; ++j) {
                let v = values[i][j];
                if (v.trim().length == 0) {
                    values[i][j] = undefined;
                } else hasValue = true;
            }

            if (!hasValue) values.splice(i, 1);
            else ++i;
        }

        return values;
    }
}
TabLoader.register(".tab");

// /////////////////////////////////////////////////////////////////////////////////
class DefaultStringLoader extends Loader {
    protected async loadRawDataObjectImp(file: string, config: unknown) {
        return (await loadTextFileData(file, config)) as any;
    }

    public createDataReader() {
        return new StringReader();
    }
}
DefaultStringLoader.register(".txt");

// /////////////////////////////////////////////////////////////////////////////////
interface IIniLoaderConfig {
    // encoding?: string; 有需求在加
    lineSeparator?: string;
    keyValueSeparator?: string;
}

class IniLoader extends Loader {
    protected async loadRawDataObjectImp(file: string, config: IIniLoaderConfig) {
        let data = await loadTextFileData(file, config);
        let lines = data.split(config.lineSeparator ?? /\r?\n/);

        let keyValueSeparator = config.keyValueSeparator ?? getGlobalConfig().defaultIniKeyValueSeparator;
        let ret = new Array<string[]>();
        let elements;

        for (const line of lines) {
            elements = line.split(keyValueSeparator);
            ret.push(elements);
        }
        return ret;
    }

    public createDataReader() {
        return new StringReader();
    }
}
IniLoader.register(".ini");

// Module-level CSV pre-parse cache: populated by GenerateRawData before processSingle runs
const csvCache = new Map<string, string[][]>();
export function setCsvPreParseCache(file: string, rows: string[][]): void {
    csvCache.set(file.replaceAll("\\", "/"), rows);
}
export function clearCsvPreParseCache(): void {
    csvCache.clear();
}

// /////////////////////////////////////////////////////////////////////////////////
class CsvLoader extends Loader {
    protected async loadRawDataObjectImp(file: string, config: unknown) {
        const cached = csvCache.get(file.replaceAll("\\", "/"));
        if (cached) return cached;

        let data = await loadTextFileData(file, config);

        const _csvParseStart = Date.now();
        let lineData = csv.parse(data, {
            relax_quotes: true,
            relax_column_count: true,
            skip_empty_lines: true,
            skip_records_with_empty_values: true,
        }) as string[][];
        const _csvParseTime = (Date.now() - _csvParseStart) / 1000;
        ExportLogger.logVerbose(`CSV parse, time: ${_csvParseTime} s, file: ${file}`);

        let ret = new Array<string[]>();
        for (let line of lineData) {
            // if (line.length == 0 || line[0].startsWith("#")) continue;

            // let hasValue = false;
            // for (let i = 0; i < line.length; ++i) {
            //     if (line[i].trim().length > 0) {
            //         hasValue = true;
            //         break;
            //     }
            // }

            ret.push(line);
        }
        return ret;
    }

    public createDataReader() {
        return new StringReader();
    }
}
CsvLoader.register(".csv");
