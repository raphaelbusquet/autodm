import type { Env } from './types';
import type { YtComment } from './youtube';
import { hmacSha256Hex, safeEqual } from './util';

/**
 * Fan-out: the Workers Free plan allows 50 D1 queries and 50 subrequests per invocation, so heavy work
 * (one post's comments, one comment, one retry) runs in its own invocation through a service binding to
 * this same Worker. Each sub-invocation gets a fresh budget.
 */
export type Task =
  | { type: 'poll_media'; mediaId: string }
  | { type: 'comment'; comment: { id: string; text?: string; timestamp?: string; from?: { id: string; username?: string } }; mediaId: string }
  | { type: 'retry'; id: number }
  | { type: 'yt_poll' }
  | { type: 'yt_comment'; comment: YtComment };

export const TASK_PATH = '/internal/task';

async function taskKey(env: Env): Promise<string> {
  return hmacSha256Hex(env.IG_APP_SECRET || env.ADMIN_PASSWORD, 'autodm-internal-task');
}

export async function verifyTask(env: Env, header: string | undefined): Promise<boolean> {
  return Boolean(header) && safeEqual(header!, await taskKey(env));
}

/** Runs tasks in parallel sub-invocations. Without the SELF binding (local tests) runs them inline. */
export async function dispatch(env: Env, tasks: Task[], runInline: (task: Task) => Promise<void>): Promise<void> {
  if (tasks.length === 0) return;
  if (!env.SELF) {
    for (const t of tasks) await runInline(t);
    return;
  }
  const key = await taskKey(env);
  const results = await Promise.allSettled(
    tasks.map(async (t) => {
      const res = await env.SELF!.fetch(`https://autodm.internal${TASK_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-autodm-task': key },
        body: JSON.stringify(t),
      });
      return `${t.type}:${res.status}:${await res.text()}`;
    }),
  );
  const failed = results.filter((r) => r.status === 'rejected' || !/:200:/.test(r.value));
  if (failed.length) console.error('dispatch failed', JSON.stringify(failed.map((r) => (r.status === 'fulfilled' ? r.value : String(r.reason)))));
}
