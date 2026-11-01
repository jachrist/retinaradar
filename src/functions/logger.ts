import type { InvocationContext } from "@azure/functions";
import type { Logger } from "../pipeline/run.js";

export const contextLogger = (ctx: InvocationContext): Logger => ({
  info: (m) => ctx.log(m),
  warn: (m) => ctx.warn(m),
  error: (m) => ctx.error(m),
});
