import { EOL } from "node:os";
import { stdin as input, stdout as output } from "node:process";
import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { clampIndex } from "../utils/array";

const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CURSOR_HOME = "\x1b[H";
const CLEAR_SCREEN = "\x1b[2J";

export async function selectValue(
    label: string,
    choices: string[],
    defaultIndex: number,
    normalizeCustomValue: (value: string) => string,
): Promise<string> {
    if (input.isTTY && output.isTTY) {
        return selectWithKeyboard(label, choices, defaultIndex);
    }

    return selectValueFallback(label, choices, defaultIndex, normalizeCustomValue);
}

async function selectValueFallback(
    label: string,
    choices: string[],
    defaultIndex: number,
    normalizeCustomValue: (value: string) => string,
): Promise<string> {
    const safeDefaultIndex = clampIndex(defaultIndex, choices);
    const prompt = choices.map((value, index) => `${index + 1}) ${value}`).join(", ");
    const rl = createInterface({ input, output });
    try {
        while (true) {
            const value = (await rl.question(`${label} (${prompt}, default ${safeDefaultIndex + 1}): `)).trim();
            if (!value) {
                return choices[safeDefaultIndex];
            }

            const selectedIndex = Number.parseInt(value, 10);
            if (!Number.isNaN(selectedIndex) && choices[selectedIndex - 1]) {
                return choices[selectedIndex - 1];
            }

            return normalizeCustomValue(value);
        }
    } finally {
        rl.close();
    }
}

function selectWithKeyboard(label: string, choices: string[], defaultIndex: number): Promise<string> {
    return new Promise((resolveSelection, rejectSelection) => {
        let selectedIndex = clampIndex(defaultIndex, choices);
        const defaultChoiceIndex = clampIndex(defaultIndex, choices);
        const visibleChoiceCount = getVisibleChoiceCount(choices.length);

        const cleanup = (): void => {
            input.off("keypress", onKeypress);
            input.setRawMode(false);
            input.pause();
            output.write(SHOW_CURSOR);
            output.write(EXIT_ALT_SCREEN);
        };

        const render = (): void => {
            const windowStartIndex = getChoiceWindowStart(selectedIndex, visibleChoiceCount, choices.length);
            const windowEndIndex = windowStartIndex + visibleChoiceCount;
            output.write(CURSOR_HOME);
            output.write(CLEAR_SCREEN);
            output.write(`${label} (use Up/Down, Enter to select):${EOL}`);
            output.write(windowStartIndex > 0 ? `  ... ${windowStartIndex} more above${EOL}` : `${EOL}`);
            for (let index = windowStartIndex; index < windowEndIndex; index += 1) {
                const marker = index === selectedIndex ? "> " : "  ";
                const defaultLabel = index === defaultChoiceIndex ? " (default)" : "";
                output.write(`${marker}${choices[index]}${defaultLabel}${EOL}`);
            }
            const remaining = choices.length - windowEndIndex;
            output.write(remaining > 0 ? `  ... ${remaining} more below${EOL}` : `${EOL}`);
            output.write(`${EOL}`);
        };

        const onKeypress = (_text: string, key: { name?: string; ctrl?: boolean }): void => {
            if (key.ctrl && key.name === "c") {
                cleanup();
                rejectSelection(new Error("Operation cancelled."));
                return;
            }

            switch (key.name) {
                case "up":
                    selectedIndex = selectedIndex === 0 ? choices.length - 1 : selectedIndex - 1;
                    render();
                    break;
                case "down":
                    selectedIndex = selectedIndex === choices.length - 1 ? 0 : selectedIndex + 1;
                    render();
                    break;
                case "return":
                case "enter":
                    cleanup();
                    output.write(`${label}: ${choices[selectedIndex]}${EOL}`);
                    resolveSelection(choices[selectedIndex]);
                    break;
                default:
                    break;
            }
        };

        emitKeypressEvents(input);
        input.setRawMode(true);
        input.resume();
        input.on("keypress", onKeypress);
        output.write(ENTER_ALT_SCREEN);
        output.write(HIDE_CURSOR);
        render();
    });
}

function getVisibleChoiceCount(choiceCount: number): number {
    const terminalRows = output.rows ?? 12;
    const availableRows = terminalRows - 5;
    return Math.max(3, Math.min(choiceCount, 9, availableRows));
}

function getChoiceWindowStart(selectedIndex: number, visibleChoiceCount: number, choiceCount: number): number {
    const halfWindow = Math.floor(visibleChoiceCount / 2);
    const maxStart = Math.max(0, choiceCount - visibleChoiceCount);
    return Math.max(0, Math.min(selectedIndex - halfWindow, maxStart));
}
