import { Schema } from "../schema/Base";

import type { Constructor, IData } from "./Define";

export type InstanceDataType<T> = T extends AnyType ? any : T extends Constructor<IData> ? InstanceType<T> : T;
export { Schema };

export class AnyType implements IData {
    public getDescription() {
        return "AnyType";
    }
}

export class LastProcessorInputData implements IData {
    public getDescription() {
        return "LastProcessorInputData";
    }
}

export class LastProcessorOutputData implements IData {
    public getDescription() {
        return "LastProcessorOutputData";
    }
}

// ///////////////////////////////////////////////////////////////////////////////////////////////////
export class OutputExtraData {}

export class OutputData implements IData {
    public data?: unknown;
    public sourcePath: string = "";
    public targetPath: string = "";
    public extraData = new Array<OutputExtraData>();

    public getSourcePath(): string {
        return this.sourcePath;
    }
    public getTargetPath(): string {
        return this.targetPath;
    }
    public getDescription(): string {
        return "OutputData";
    }
    public setData(data?: unknown) {
        this.data = data;
    }
    public getData() {
        return this.data;
    }
    public addExtraData(extraData: OutputExtraData) {
        this.extraData.push(extraData);
    }
    public removeExtraData(extraData: OutputExtraData) {
        this.extraData = this.extraData.filter((v) => v !== extraData);
    }
    public getExtraData<T extends OutputExtraData>(type: Constructor<T>): T | undefined {
        return this.extraData.find((v) => v instanceof type) as T;
    }
}

// ///////////////////////////////////////////////////////////////////////////////////////////////////
export class FilePathData implements IData {
    public constructor(public path: string, public hash: string) {}

    public getDescription() {
        return this.path;
    }
}

// ///////////////////////////////////////////////////////////////////////////////////////////////////
export class DataWithSchema extends OutputData {
    public schema: Schema;
    public toBeDeleted = false;

    public constructor(data: object, schema: Schema) {
        super();

        this.schema = schema;
        this.data = data;
    }

    public getSourcePath(): string {
        return this.schema.source?.path ?? this.schema.config.name ?? "no source data";
    }
    public getDescription() {
        return `raw object of ${this.schema.getDescription()}`;
    }
}

// ///////////////////////////////////////////////////////////////////////////////////////////////////
