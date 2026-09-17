import { F } from "k-ts-framework";

export const GAME_DATA_COLLECTION_SYSTEM = "GameDataCollectionSystem";

export class GameDataInfo {
    public constructor(public tag?: string) {}
}

export class GameDataInfoRegistry implements F.IEnvData {
    public typeToInfos = new Map<symbol, GameDataInfo[]>();

    public inheritFrom(source: GameDataInfoRegistry) {
        for (let [k, v] of source.typeToInfos) {
            let infos = this.typeToInfos.get(k);
            if (infos) {
                for (let newInfo of v) {
                    if (infos.indexOf(newInfo) < 0) infos.push(newInfo);
                }
            } else {
                infos = new Array<GameDataInfo>(...v);
                this.typeToInfos.set(k, infos);
            }
        }
    }
}
