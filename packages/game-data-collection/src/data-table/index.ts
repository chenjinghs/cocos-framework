import { GameDataInfo } from "../Define";

export enum EDataTableKeyType {
    Array = 0,
    Single,
    Double,
    Triple,
    Quadruple,

    Custom,
}

export class DataTableTemplateInfo extends GameDataInfo {
    public constructor(public path: string, public keyType: EDataTableKeyType, public tag?: string) {
        super(tag);
    }
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface IDataTableTemplate {}
