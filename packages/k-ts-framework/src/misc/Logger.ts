export enum ELogLevel {
    Error,
    Warning,
    Information,
    Debug,
}

export class Logger {
    public static create(tag: string, logLevel = ELogLevel.Information) {
        return new Logger(tag, logLevel);
    }

    private ignoreTags: string[] = [];

    private constructor(private tag: string, private logLevel: ELogLevel) {}

    public setLogLevel(level: ELogLevel) {
        this.logLevel = level;
    }

    public addIgnoreTag(tag: string) {
        if (this.ignoreTags.includes(tag)) return;
        this.ignoreTags.push(tag);
    }

    public e(subTag: string, ...messages: any[]) {
        this.log(ELogLevel.Error, subTag, ...messages);
    }

    public w(subTag: string, ...messages: any[]) {
        this.log(ELogLevel.Warning, subTag, ...messages);
    }

    public i(subTag: string, ...messages: any[]) {
        this.log(ELogLevel.Information, subTag, ...messages);
    }

    public d(subTag: string, ...messages: any[]) {
        this.log(ELogLevel.Debug, subTag, ...messages);
    }

    private log(level: ELogLevel, subTag: string, ...messages: any[]) {
        if (level > this.logLevel) return;
        if (this.ignoreTags.includes(subTag) && level > ELogLevel.Warning) return;

        switch (level) {
            case ELogLevel.Error:
                console.error(`[${this.tag}][${subTag}]`, ...messages);
                break;
            case ELogLevel.Warning:
                console.warn(`[${this.tag}][${subTag}]`, ...messages);
                break;
            case ELogLevel.Information:
                console.info(`[${this.tag}][${subTag}]`, ...messages);
                break;
            case ELogLevel.Debug:
                console.debug(`[${this.tag}][${subTag}]`, ...messages);
                break;
        }
    }
}