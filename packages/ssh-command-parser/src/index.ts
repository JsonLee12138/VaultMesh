export interface SshCommandImport {
  title: string;
  host: string;
  port: number;
  username: string;
  notes: string;
}

const OPTIONS_WITH_VALUE = new Set([
  "B", "b", "c", "D", "E", "e", "F", "I", "i", "J", "L", "l", "m", "O", "o",
  "P", "p", "Q", "R", "S", "W", "w",
]);

interface ParsedOption { name: string; value: string | null; display: string }

/** Parse an SSH invocation without evaluating any shell syntax. */
export function parseSshCommand(command: string): SshCommandImport {
  if (command.length > 10_000) throw new Error("SSH 命令过长，无法导入。");
  const tokens = tokenize(command.trim());
  if (tokens.length === 0) throw new Error("剪贴板为空，请先复制一条 SSH 命令。");

  const executable = tokens.shift()!;
  const executableName = executable.replaceAll("\\", "/").split("/").pop()?.toLowerCase().replace(/\.exe$/u, "");
  if (executableName !== "ssh" && !executable.toLowerCase().startsWith("ssh://")) {
    throw new Error("剪贴板内容不是 SSH 命令，请复制例如 ssh root@192.168.1.1。");
  }

  if (executable.toLowerCase().startsWith("ssh://")) {
    if (tokens.length > 0) throw new Error("ssh:// 地址后不能包含额外的命令参数。");
    return parseSshUrl(executable);
  }

  const options: ParsedOption[] = [];
  let destination: string | undefined;
  let remoteCommand: string[] = [];
  let optionsEnded = false;

  while (tokens.length > 0) {
    const token = tokens.shift()!;
    if (!optionsEnded && token === "--") { optionsEnded = true; continue; }
    if (!optionsEnded && token.startsWith("-") && token !== "-") {
      options.push(readOption(token, tokens));
      continue;
    }
    destination = token;
    remoteCommand = tokens;
    break;
  }

  if (!destination) throw new Error("SSH 命令缺少目标主机。");
  if (destination.toLowerCase().startsWith("ssh://")) {
    const parsed = parseSshUrl(destination);
    return { ...parsed, notes: buildNotes(options, remoteCommand, parsed.notes) };
  }

  const endpoint = parseDestination(destination);
  const sshConfig = parseConfigOptions(options);
  const username = endpoint.username || lastOptionValue(options, "l") || sshConfig.user || "";
  const host = sshConfig.hostname || endpoint.host;
  const port = parsePort(lastOptionValue(options, "p") || sshConfig.port);

  return validateImport({
    title: username ? `${username}@${host}` : host,
    host,
    port,
    username,
    notes: buildNotes(options, remoteCommand),
  });
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  let started = false;

  for (const character of input) {
    if (escaping) { token += character; escaping = false; started = true; continue; }
    if (character === "\\" && quote !== "'") { escaping = true; started = true; continue; }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      started = true;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; started = true; continue; }
    if (/\s/u.test(character)) {
      if (started) { tokens.push(token); token = ""; started = false; }
      continue;
    }
    token += character;
    started = true;
  }

  if (escaping) throw new Error("SSH 命令末尾包含不完整的转义符。");
  if (quote) throw new Error("SSH 命令包含未闭合的引号。");
  if (started) tokens.push(token);
  return tokens;
}

function readOption(token: string, remaining: string[]): ParsedOption {
  if (token.startsWith("--")) {
    const separator = token.indexOf("=");
    return { name: separator === -1 ? token.slice(2) : token.slice(2, separator), value: separator === -1 ? null : token.slice(separator + 1), display: token };
  }

  const name = token[1]!;
  if (!OPTIONS_WITH_VALUE.has(name)) return { name, value: null, display: token };
  const attachedValue = token.slice(2);
  const value = attachedValue || remaining.shift();
  if (value === undefined) throw new Error(`SSH 参数 -${name} 缺少值。`);
  return { name, value, display: attachedValue ? token : `${token} ${shellQuote(value)}` };
}

function parseDestination(destination: string): { username: string; host: string } {
  const separator = destination.lastIndexOf("@");
  const username = separator === -1 ? "" : destination.slice(0, separator);
  let host = separator === -1 ? destination : destination.slice(separator + 1);
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host || /\s/u.test(host)) throw new Error("SSH 命令中的目标主机无效。");
  return { username, host };
}

function parseSshUrl(value: string): SshCommandImport {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("剪贴板中的 ssh:// 地址无效。"); }
  if (url.protocol !== "ssh:" || !url.hostname) throw new Error("剪贴板中的 ssh:// 地址无效。");
  if (url.password) throw new Error("不支持在 ssh:// 地址中导入密码，请在身份验证区域单独填写。");
  if ((url.pathname !== "" && url.pathname !== "/") || url.search || url.hash) throw new Error("ssh:// 地址不能包含路径、查询参数或片段。");
  const username = decodeURIComponent(url.username);
  const host = url.hostname.replace(/^\[|\]$/gu, "");
  const port = parsePort(url.port);
  return validateImport({ title: username ? `${username}@${host}` : host, host, port, username, notes: "" });
}

function parseConfigOptions(options: ParsedOption[]): { user?: string; hostname?: string; port?: string } {
  const result: { user?: string; hostname?: string; port?: string } = {};
  for (const option of options) {
    if (option.name !== "o" || !option.value) continue;
    const match = /^([^=\s]+)(?:=|\s+)(.+)$/u.exec(option.value);
    if (!match) continue;
    const key = match[1]!.toLowerCase();
    const value = match[2]!.trim();
    if (key === "user") result.user = value;
    if (key === "hostname") result.hostname = value;
    if (key === "port") result.port = value;
  }
  return result;
}

function lastOptionValue(options: ParsedOption[], name: string): string | undefined {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (options[index]?.name === name) return options[index]?.value ?? undefined;
  }
  return undefined;
}

function parsePort(value?: string): number {
  if (!value) return 22;
  if (!/^\d+$/u.test(value)) throw new Error("SSH 端口必须是 1 到 65535 之间的数字。");
  const port = Number(value);
  if (port < 1 || port > 65_535) throw new Error("SSH 端口必须是 1 到 65535 之间的数字。");
  return port;
}

function buildNotes(options: ParsedOption[], remoteCommand: string[], existing = ""): string {
  const lines = existing ? [existing] : [];
  if (options.length > 0) lines.push(`SSH 参数：${options.map((option) => option.display).join(" ")}`);
  if (remoteCommand.length > 0) lines.push(`远程命令：${remoteCommand.map(shellQuote).join(" ")}`);
  return lines.join("\n");
}

function shellQuote(value: string): string {
  return /^[a-zA-Z0-9_@%+=:,./~-]+$/u.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

function validateImport(imported: SshCommandImport): SshCommandImport {
  if (imported.title.length > 256 || imported.host.length > 256 || imported.username.length > 2_048 || imported.notes.length > 10_000) {
    throw new Error("SSH 命令中的主机、用户名或参数过长，无法导入。");
  }
  return imported;
}
