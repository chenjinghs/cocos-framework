import { Constructor } from "../data/Define";
import { Processor } from "../processor/Base";
import { ICustomJsonTransformer, registerCustomJsonType } from "./Util";

// 自定义Field的导出器，用于文本类型的导出
export abstract class CustomFieldTextExporter {
    public static targetToExporters = new Map<Constructor, Array<CustomFieldTextExporter>>();

    public static register(this: Constructor<CustomFieldTextExporter>, target: Constructor) {
        let arr = CustomFieldTextExporter.targetToExporters.get(target);
        if (!arr) {
            arr = [];
            CustomFieldTextExporter.targetToExporters.set(target, arr);
        }

        let temp = new this();
        registerCustomJsonType(temp.getJsonTransformer());
        arr.push(temp);
    }

    public static find(target: any) {
        for (let [ctor, arr] of this.targetToExporters) {
            if (target instanceof ctor) {
                return arr;
            }
        }
        return [];
    }

    public abstract fieldType: string;
    public abstract exportedType: string;
    public abstract getJsonTransformer(): ICustomJsonTransformer;
    public onPreWriteFile(path: string, out: Array<string>) {}
}

export class CustomFieldTextExporterHelper {
    public exporters: Array<CustomFieldTextExporter>;
    public used = new Set<CustomFieldTextExporter>();

    public constructor(processor: Processor<any>) {
        this.exporters = CustomFieldTextExporter.find(processor);
    }

    public verifyExportType(fieldType: string) {
        for (let v of this.exporters) {
            if (v.fieldType === fieldType) {
                this.used.add(v);
                return v.exportedType;
            }
        }
        return undefined;
    }

    public onPreWriteFile(path: string, out: Array<string>) {
        for (let v of this.used) {
            v.onPreWriteFile(path, out);
        }
    }
}