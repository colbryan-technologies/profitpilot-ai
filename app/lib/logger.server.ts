import pino from "pino";
import { env } from "./env.server";

const REDACT_PATHS = [
  "accessToken",
  "refreshToken",
  "*.accessToken",
  "*.refreshToken",
  "credentialsEnc",
  "*.credentialsEnc",
  "req.headers.authorization",
  "req.headers.cookie",
  "headers.authorization",
  "headers.cookie",
  "headers['x-shopify-hmac-sha256']",
  "apiSecretKey",
  "password",
  "*.password",
  "token",
  "*.token",
  "email",
  "*.email",
];

export const logger = pino({
  level: env().LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  base: { service: "profitpilot" },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env().NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } }
    : {}),
});

export type Logger = typeof logger;

export function storeLogger(storeId: string, extra?: Record<string, unknown>) {
  return logger.child({ storeId, ...extra });
}
