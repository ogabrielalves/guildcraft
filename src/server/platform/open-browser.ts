import open, { apps } from 'open';

export type Opener = (target: string, options?: Parameters<typeof open>[1]) => Promise<unknown>;

const APP_BROWSERS = [apps.chrome, apps.edge];

export async function openBrowser(url: string, opener: Opener = open): Promise<'app' | 'tab'> {
  for (const name of APP_BROWSERS) {
    try {
      await opener(url, { app: { name, arguments: [`--app=${url}`] } });
      return 'app';
    } catch {
      continue;
    }
  }
  await opener(url);
  return 'tab';
}
