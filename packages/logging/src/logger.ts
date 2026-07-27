import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { redact, type RedactOptions } from "./redact";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60
};

/** Well-known channels, each backed by its own JSONL file. */
export type LogChannel =
  | "application"
  | "access"
  | "agent"
  | "model"
  | "tool"
  | "memory"
  | "audit";

const CHANNEL_FILES: Record<LogChannel, string> = {
  application: "application.log",
  access: "access.log",
  agent: "agent.log",
  model: "model.log",
  tool: "tool.log",
  memory: "memory.log",
  audit: "audit.log"
};

export interface LogContext {
  serviceVersion?: string;
  environment?: string;
  instanceId?: string;
  requestId?: string;
  runId?: string;
  executionId?: string;
  correlationId?: string;
  projectId?: string;
  client?: string;
  [key: string]: unknown;
}

export interface Logger {
  level: LogLevel;
  trace(fields: Record<string, unknown>, msg?: string): void;
  debug(fields: Record<string, unknown>, msg?: string): void;
  info(fields: Record<string, unknown>, msg?: string): void;
  warn(fields: Record<string, unknown>, msg?: string): void;
  error(fields: Record<string, unknown>, msg?: string): void;
  fatal(fields: Record<string, unknown>, msg?: string): void;
  child(bindings: LogContext): Logger;
}

export interface LoggingOptions {
  logRoot: string;
  level: LogLevel;
  base?: LogContext;
  console?: boolean;
  redactOptions?: RedactOptions;
}

/**
 * Owns file streams and produces channel loggers. All records are JSON Lines.
 * error/fatal records are additionally duplicated to error.log for triage.
 */
export class LoggingManager {
  private readonly streams = new Map<string, WriteStream>();
  private readonly root: string;
  private readonly level: LogLevel;
  private readonly base: LogContext;
  private readonly console: boolean;
  private readonly redactOptions?: RedactOptions;

  constructor(options: LoggingOptions) {
    this.root = resolve(options.logRoot);
    this.level = options.level;
    this.base = options.base ?? {};
    this.console = options.console ?? false;
    this.redactOptions = options.redactOptions;
    mkdirSync(this.root, { recursive: true });
  }

  private stream(file: string): WriteStream {
    let s = this.streams.get(file);
    if (!s) {
      s = createWriteStream(join(this.root, file), { flags: "a" });
      this.streams.set(file, s);
    }
    return s;
  }

  private write(channel: LogChannel, level: LogLevel, context: LogContext, fields: Record<string, unknown>, msg?: string): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;

    const record = redact(
      {
        time: new Date().toISOString(),
        level,
        channel,
        ...this.base,
        ...context,
        ...fields,
        ...(msg ? { msg } : {})
      },
      this.redactOptions
    );

    const line = JSON.stringify(record) + "\n";
    this.stream(CHANNEL_FILES[channel]).write(line);
    if (LEVEL_ORDER[level] >= LEVEL_ORDER.error) {
      this.stream("error.log").write(line);
    }
    if (this.console) {
      const sink = LEVEL_ORDER[level] >= LEVEL_ORDER.error ? process.stderr : process.stdout;
      sink.write(line);
    }
  }

  logger(channel: LogChannel, context: LogContext = {}): Logger {
    const make = (ctx: LogContext): Logger => {
      const at = (level: LogLevel) => (fields: Record<string, unknown>, msg?: string) =>
        this.write(channel, level, ctx, fields ?? {}, msg);
      return {
        level: this.level,
        trace: at("trace"),
        debug: at("debug"),
        info: at("info"),
        warn: at("warn"),
        error: at("error"),
        fatal: at("fatal"),
        child: (bindings: LogContext) => make({ ...ctx, ...bindings })
      };
    };
    return make(context);
  }

  async close(): Promise<void> {
    await Promise.all(
      [...this.streams.values()].map(
        (s) => new Promise<void>((res) => s.end(() => res()))
      )
    );
    this.streams.clear();
  }
}
