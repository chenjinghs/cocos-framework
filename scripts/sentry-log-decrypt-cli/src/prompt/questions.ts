import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

export async function askInputPath(rl: ReturnType<typeof createInterface>): Promise<string> {
    while (true) {
        const value = (await rl.question("input path (Enter to choose file): ")).trim();
        if (value) {
            return value;
        }

        const selectedPath = openInputFileDialog();
        if (selectedPath) {
            console.log(`input path: ${selectedPath}`);
            return selectedPath;
        }

        console.log("No file selected. Please enter a path or press Enter to choose a file.");
    }
}

export async function askRequired(rl: ReturnType<typeof createInterface>, label: string): Promise<string> {
    while (true) {
        const value = (await rl.question(`${label}: `)).trim();
        if (value) {
            return value;
        }

        console.log(`${label} is required.`);
    }
}

export async function askInteger(rl: ReturnType<typeof createInterface>, label: string): Promise<number> {
    while (true) {
        const value = (await rl.question(`${label}: `)).trim();
        const parsed = Number.parseInt(value, 10);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }

        console.log(`${label} must be an integer.`);
    }
}

function openInputFileDialog(): string | undefined {
    if (process.platform !== "win32") {
        return undefined;
    }

    const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
        "$dialog.Title = 'Select encrypted Sentry log'",
        "$dialog.Filter = 'Encrypted logs (*.enc;*.bak)|*.enc;*.bak|All files (*.*)|*.*'",
        "$dialog.InitialDirectory = [Environment]::GetFolderPath('UserProfile') + '\\Downloads'",
        "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }",
    ].join("; ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], {
        encoding: "utf8",
        windowsHide: false,
    });

    if (result.status !== 0) {
        return undefined;
    }

    const selectedPath = result.stdout.trim();
    return selectedPath ? selectedPath : undefined;
}
