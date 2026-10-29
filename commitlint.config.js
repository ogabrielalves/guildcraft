const FORBIDDEN = [/claude/i, /co-authored-by/i, /generated with/i, /\bai\b/i];

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-ai-mention': ({ raw }) => {
          const hit = FORBIDDEN.find((pattern) => pattern.test(raw ?? ''));
          return [!hit, `commit message must not match ${String(hit)}`];
        },
      },
    },
  ],
  rules: {
    'header-max-length': [2, 'always', 72],
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'perf',
        'test',
        'docs',
        'style',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'shared',
        'server',
        'agents',
        'hooks',
        'mcp',
        'cli',
        'platform',
        'web',
        'game',
        'ui',
        'i18n',
        'assets',
        'deps',
        'release',
      ],
    ],
    'no-ai-mention': [2, 'always'],
  },
};
