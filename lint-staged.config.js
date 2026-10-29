const quote = (files) => files.map((file) => JSON.stringify(file)).join(' ');

export default {
  '*.{ts,js}': (files) => [
    `eslint --fix ${quote(files)}`,
    `prettier --write ${quote(files)}`,
    `vitest related --run --passWithNoTests ${quote(files)}`,
  ],
  '*.{json,md,yml,yaml,css,html}': 'prettier --write',
};
