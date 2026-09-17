import { DEFAULT_LOCALIZATION, EGameLanguage, findGameLanguage, ILocalization, LocalizationSet } from "./LanguageDefine";

export function getLocalization(): ILocalization {
    let savedLanguage = CS.KPlayerPrefs.GetString("global.GameLanguage", "") as EGameLanguage | "";
    let systemLanguage = CS.UnityEngine.Application.systemLanguage;
    let gameLanguage = savedLanguage || findGameLanguage(systemLanguage);
    return (gameLanguage ? LocalizationSet.get(gameLanguage) : undefined) ?? DEFAULT_LOCALIZATION;
}

export function getLocalizationByKey(key: string): string {
    let localization = getLocalization();
    let value = localization[key as keyof ILocalization];
    return typeof value === "string" ? value : localization.unknown_error;
}
