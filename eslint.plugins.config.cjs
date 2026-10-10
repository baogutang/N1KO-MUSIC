/**
 * 插件与脚本的 lint 配置（阶段 5 / F18）。
 *
 * plugins/ 是 CommonJS ES5 风格（沙箱运行时用 Function 构造器执行，刻意
 * 不用新语法），规则因此放宽；scripts/ 是 Node ESM（.mjs）。
 * 由 frontend 里的 eslint 运行（仓库根没有自己的 eslint 依赖），
 * 具体命令见根 package.json 的 lint:plugins 脚本。
 */
module.exports = {
  root: true,
  env: { es2022: true, node: true, browser: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'script' },
  overrides: [
    {
      files: ['**/*.mjs'],
      parserOptions: { sourceType: 'module' },
    },
    {
      // 沙箱注入的全局（plugins 的运行时参数与构造器）
      files: ['plugins/**/*.js'],
      globals: {
        env: 'readonly',
        PluginError: 'readonly',
      },
    },
    {
      // 插件允许 async/await（运行时支持），其余保持宽松
      files: ['plugins/**/*.js'],
      rules: {
        'no-var': 'off',
        'prefer-const': 'off',
        'object-shorthand': 'off',
        'quote-props': 'off',
        'no-empty': ['error', { allowEmptyCatch: true }],
      },
    },
  ],
  rules: {
    'no-undef': 'error',
    'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
    'no-redeclare': 'error',
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-throw-literal': 'error',
    eqeqeq: ['warn', 'smart'],
  },
}
