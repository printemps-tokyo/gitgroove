/** Play a WAV file with the platform's default command-line player. */
import { spawn } from "node:child_process";

/** The platform command that plays a WAV file, or undefined if unknown. */
export function playerCommand(): { cmd: string; args: string[] } | undefined {
  switch (process.platform) {
    case "darwin":
      return { cmd: "afplay", args: [] };
    case "win32":
      // PowerShell's SoundPlayer plays and waits.
      return {
        cmd: "powershell",
        args: ["-NoProfile", "-Command", "(New-Object Media.SoundPlayer $args[0]).PlaySync()"],
      };
    default:
      // Linux: try aplay (alsa-utils); users can pipe to anything else themselves.
      return { cmd: "aplay", args: ["-q"] };
  }
}

/** Play `path`, resolving when playback finishes. Rejects if no player is found. */
export function playWav(path: string): Promise<void> {
  const player = playerCommand();
  if (!player) return Promise.reject(new Error("no known audio player for this platform"));
  return new Promise<void>((resolve, reject) => {
    const child = spawn(player.cmd, [...player.args, path], { stdio: "ignore" });
    child.on("error", (err) =>
      reject(new Error(`could not run "${player.cmd}" to play audio: ${err.message}`)),
    );
    child.on("exit", () => resolve());
  });
}
