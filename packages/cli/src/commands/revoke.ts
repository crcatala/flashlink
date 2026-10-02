import { ApiError } from '@r2-fastlink/core';
import { extractCode } from '../code.ts';
import type { Context } from '../context.ts';
import { CliError } from '../errors.ts';

export async function revoke(
  target: string,
  opts: { purge?: boolean },
  ctx: Context,
): Promise<void> {
  const code = extractCode(target);
  const client = ctx.client();
  try {
    if (opts.purge) {
      await client.purge(code);
      ctx.history.update(code, { state: 'purged' });
      ctx.err(`${ctx.style.green('✓')} ${code} deleted from the server.`);
    } else {
      const info = await client.revoke(code);
      ctx.history.update(code, { state: 'revoked', expiresAt: info.expiresAt });
      ctx.err(
        `${ctx.style.green('✓')} ${code} is closed. ` +
          ctx.style.dim(`Re-open with \`r2fl refresh ${code}\`.`),
      );
    }
  } catch (err) {
    if (err instanceof ApiError && err.code === 'not_found') {
      ctx.history.update(code, { state: 'purged' });
      throw new CliError(`${code} no longer exists on the server.`);
    }
    throw err;
  }
}
