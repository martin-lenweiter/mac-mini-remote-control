import { NAMER } from '@/lib/config';

// Turn arbitrary model output into a safe session-name fragment: lowercase,
// only [a-z0-9-], collapsed/trimmed hyphens, length-capped. Returns '' if
// nothing usable remains (caller then falls back to the repo name).
export function slugify(raw: string): string {
  const firstLine = raw.split('\n').find((l) => l.trim().length > 0) ?? '';
  return firstLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

function buildPrompt(repo: string, task: string): string {
  const taskLine = task.trim() ? `Task: ${task.trim()}` : 'Task: (none given)';
  return [
    'You name coding sessions. Output ONE short kebab-case slug',
    '(2-4 words, lowercase a-z 0-9 and hyphens only, no prefixes, no quotes,',
    'no explanation) describing the work. If no task is given, base it on the repo.',
    `Repo: ${repo}`,
    taskLine,
    'Name:',
  ].join('\n');
}

async function callOllama(body: object, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${NAMER.url}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) return '';
    const data = (await res.json()) as { response?: string };
    return data.response ?? '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** Generate a descriptive session slug via local gemma. '' if unavailable. */
export async function generateSessionSlug(repo: string, task: string): Promise<string> {
  const response = await callOllama(
    {
      model: NAMER.model,
      stream: false,
      options: { temperature: 0.4, num_predict: 24 },
      prompt: buildPrompt(repo, task),
    },
    NAMER.timeoutMs,
  );
  return slugify(response);
}

/** Preload the model so the first real generation isn't a cold start. */
export async function warmupNamer(): Promise<void> {
  await callOllama(
    { model: NAMER.model, stream: false, options: { num_predict: 1 }, prompt: 'hi' },
    30000,
  );
}
