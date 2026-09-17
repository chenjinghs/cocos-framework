import { EDataTableKeyType } from "../data-table";
import { GameDataInfo } from "../Define";

export const JSON_DATA_TYPE = Symbol("JsonData");

export class JsonDataTemplateInfo extends GameDataInfo {
    public constructor(public path: string, tag?: string) {
        super(tag);
    }
}

export class JsonDataTableTemplateInfo extends JsonDataTemplateInfo {
    public constructor(path: string, public keyType: EDataTableKeyType, tag?: string) {
        super(path, tag);
    }
}

export class JsonData {
    public constructor(public info: JsonDataTemplateInfo, public obj: any | undefined) {}
    public get valid() {
        return this.obj !== undefined;
    }
}
