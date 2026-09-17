import { DEFAULT_LOCALIZATION, EGameLanguage, findGameLanguage, ILocalization, LocalizationSet } from "./LanguageDefine";
import { getSystemLanguage, keyValueStorage } from "./Util";

export function getLocalization(): ILocalization {
    let savedLanguage = keyValueStorage.getString("global.GameLanguage", "") as EGameLanguage | "";
    let systemLanguage = getSystemLanguage();
    let gameLanguage = savedLanguage || findGameLanguage(systemLanguage);
    return (gameLanguage ? LocalizationSet.get(gameLanguage) : undefined) ?? DEFAULT_LOCALIZATION;
}

export function getLocalizationByKey(key: string): string {
    let localization = getLocalization();
    let value = localization[key as keyof ILocalization];
    return typeof value === "string" ? value : localization.unknown_error;
}
