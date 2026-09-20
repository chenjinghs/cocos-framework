import assert from "node:assert/strict";
import { test } from "node:test";

import { F } from "../src/index.js";

const SCOPE_TYPE = 1 << 20;

// 两个同 type 的 env,用于覆盖 scopeBegin 的"多目标 -> tempEnv"分支
F.Env.create("scopeEnvA", SCOPE_TYPE, undefined, false);
F.Env.create("scopeEnvB", SCOPE_TYPE, undefined, false);

test("scope:内部异常向上抛出,不再被吞成 console", () => {
    let before = F.Env.current;
    assert.throws(
        () =>
            F.Env.scope(before, () => {
                throw new Error("boom-inside-scope");
            }),
        /boom-inside-scope/,
    );
    assert.equal(F.Env.current, before, "抛异常后仍须还原 current");
});

test("scope:抛出非 Error 值不应在错误处理里二次崩溃", () => {
    let before = F.Env.current;
    // 回归:原实现 catch 里读 error.message.includes(...),非 Error 抛出物会
    // 触发 TypeError 并跳过 current 还原
    assert.throws(
        () =>
            F.Env.scope(before, () => {
                throw "plain-string-throw";
            }),
        (err: unknown) => err === "plain-string-throw",
    );
    assert.equal(F.Env.current, before, "非 Error 抛出后仍须还原 current");
});

test("scope:正常执行返回 true,目标 env 不存在返回 false", () => {
    let before = F.Env.current;
    assert.equal(
        F.Env.scope(before, () => {}),
        true,
    );
    assert.equal(
        F.Env.scope("scopeEnvNotExist", () => {}),
        false,
    );
    assert.equal(F.Env.current, before);
});

test("scopeBegin/scopeEnd:单目标 env 切入后还原 current", () => {
    let before = F.Env.current;
    let handle = F.Env.scopeBegin("scopeEnvA");
    assert.equal(F.Env.current.name, "scopeEnvA", "scopeBegin 应切到目标 env");

    F.Env.scopeEnd(handle);
    assert.equal(F.Env.current, before, "scopeEnd 后须还原 current");
});

test("scopeBegin/scopeEnd:多目标 env 走 tempEnv 分支后仍还原 current", () => {
    let before = F.Env.current;
    // 回归:原实现只在单目标分支还原 current,多目标时 current 会留在 __temp 上
    let handle = F.Env.scopeBegin(SCOPE_TYPE);
    F.Env.scopeEnd(handle);
    assert.equal(F.Env.current, before, "多目标 scopeEnd 后须还原 current");
});

test("scopeBegin/scopeEnd:无匹配 env 时丢弃 tempEnv 并还原 current", () => {
    let before = F.Env.current;
    let handle = F.Env.scopeBegin(1 << 21);
    F.Env.scopeEnd(handle);
    assert.equal(F.Env.current, before, "空目标 scopeEnd 后须还原 current");
});
