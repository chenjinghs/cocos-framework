import assert from "node:assert/strict";
import { test } from "node:test";

import { D, F } from "../src/index.js";
import { getManager } from "../src/framework/Interface.js";

class PingEvent extends F.Event {}

/**
 * @D.on 从 design:paramtypes 推断订阅的 Action/Event 类型,而 tsx/esbuild 不发射
 * emitDecoratorMetadata —— 该链路下装饰器必然被跳过(生产链路 tsc/Creator 发射
 * metadata,行为正常)。这里锁住"跳过时必须告警",防止回退成静默失效。
 */
test("@D.on:元数据缺失时发出告警,不静默吞掉订阅", () => {
    let warnings: string[] = [];
    let originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
        warnings.push(args.map((v) => String(v)).join(" "));
    };

    try {
        class OnWarnProbe extends F.System {
            @D.on()
            protected onPing(_event: PingEvent): void {}
        }
        // 装饰器返回 undefined = 保留原方法，类定义本身不应被破坏
        assert.equal(OnWarnProbe.name, "OnWarnProbe");
    } finally {
        console.warn = originalWarn;
    }

    assert.ok(
        warnings.some((w) => w.includes("@D.on") && w.includes("emitDecoratorMetadata")),
        `应提示 @D.on 订阅未生效,实际告警: ${JSON.stringify(warnings)}`,
    );
});

test("this.subscribe 是该链路下的可用替代,订阅正常送达", () => {
    let hit = false;

    @D.system("OnFallbackProbe")
    class OnFallbackProbeSystem extends F.System {
        public init(): void {
            this.subscribe(PingEvent, () => {
                hit = true;
            });
        }
    }

    F.System.createByTag("OnFallbackProbe");
    assert.ok(getManager().findSystem(OnFallbackProbeSystem), "system 应已创建");
    PingEvent.dispatch();
    assert.equal(hit, true);
});
