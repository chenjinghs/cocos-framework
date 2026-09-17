import { CONFIG, ERuntime, TS_PROJECT_ROOT } from "./Define";
import { downloadFile, saveAndOpenFile, unzipFile } from "./FileUtil";
import { Logger } from "./Logger";
import { parseSentryIssueData } from "./SentryUtil";
import { parseStacktrace } from "./SourceMapUtil";

// 小游戏 sourcemap 从 Jenkins 构建产物下载;基础地址可通过环境变量覆盖。
const JENKINS_SOURCEMAP_BASE_URL =
    process.env.JENKINS_SOURCEMAP_BASE_URL ?? "https://jenkins.shiyou.kingsoft.com/job/Zero/job/Client/job/minigame/job/trunk/";

async function downloadWechatSourcemap(buildNumber: string) {
    const url = `${JENKINS_SOURCEMAP_BASE_URL}${buildNumber}/artifact/sourcemap.zip/`;
    const filePath = `./tmp/sourcemap-${buildNumber}.zip`;
    await downloadFile(url, filePath);
    return await unzipFile(filePath);
}

async function getSourceMapRes(runtime: ERuntime, buildNumber: string) {
    if (runtime === ERuntime.Wechat) {
        return await downloadWechatSourcemap(buildNumber);
    } else {
        return TS_PROJECT_ROOT;
    }
}

async function main() {
    const { buildNumber, runtime, platform, issueId, eventId, stacktrace } = await parseSentryIssueData();

    Logger.splitLine();
    Logger.info(`issue url: https://sentry.seayoo.com/organizations/sentry/issues/${issueId}/events/${eventId}/`);
    Logger.splitLine();

    const sourcemapPath = await getSourceMapRes(runtime, buildNumber);
    Logger.info(`sourcemap path: ${sourcemapPath}`);
    Logger.splitLine();

    const parsedStacktrace = await parseStacktrace(stacktrace, sourcemapPath, runtime, platform);
    Logger.info(parsedStacktrace);

    CONFIG.SAVE_RESULT && saveAndOpenFile(parsedStacktrace, `./tmp/${issueId}-${eventId}.log`);
}

main();
