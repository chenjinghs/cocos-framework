import { OutputExtraData } from "./Data";

export class JsonFileExtraData extends OutputExtraData {
    public constructor(public targetPath: string) {
        super();
    }
}

export class TaggedInfoExtraData extends OutputExtraData {
    public constructor(public infos: string[]) {
        super();
    }
}
