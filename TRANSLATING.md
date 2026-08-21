# 翻译 N1KO MUSIC · Translating N1KO MUSIC

界面文案全部集中在两个扁平 JSON 里，改完即生效，不需要懂 React。

All interface copy lives in two flat JSON files. You do not need to know React to
change any of it.

```
frontend/src/i18n/
├── index.ts                 运行时（不需要动）／ runtime, leave it alone
└── locales/
    ├── zh-CN.json           源语言，永远完整 ／ source language, always complete
    └── en-US.json           英文 ／ English
```

## 加一种语言 · Adding a language

1. 复制 `zh-CN.json`，改名为你的语言代码（BCP 47，例如 `ja-JP.json`、`de-DE.json`）。
   Copy `zh-CN.json` and rename it to your BCP 47 code.
2. 在 `frontend/src/i18n/index.ts` 里把它加进 `LOCALES` 和 `CATALOGS`——只有两行。
   Add it to `LOCALES` and `CATALOGS` in `frontend/src/i18n/index.ts`. Two lines.
3. 翻译值，**不要改 key**。
   Translate the values. Never change a key.

漏掉的 key 会自动回落到简体中文，因此不完整的翻译也可以先合进来，界面不会出现空白。

Missing keys fall back to Simplified Chinese, so a partial translation is safe to
merge — nothing will render blank.

## key 怎么读 · Reading a key

key 是 `区域.主题` 的形式，按前缀分组：

Keys are `area.subject`, grouped by prefix:

| 前缀 prefix | 含义 meaning |
| --- | --- |
| `nav.*` | 导航项 ／ navigation entries |
| `player.*` | 播放控制 ／ playback controls |
| `action.*` | 通用动作按钮 ／ generic action buttons |
| `empty.*` | 空态与错误态 ／ empty and error states |
| `section.*` | 版面栏目标题 ／ section headings |
| `settings.*` | 设置项 ／ settings |
| `issue.*` | 《本期》刊物页 ／ the Issue pages |

## 变量 · Variables

`{name}` 是占位符，翻译时必须原样保留，位置可以按语序调整：

`{name}` is a placeholder. Keep it verbatim; you may move it to fit your grammar.

```json
"selection.count": "已选 {count} / {total}"
"selection.count": "{count} of {total} selected"
```

占位符写错不会崩溃——界面上会直接显示 `{count}`，一眼就能看出哪里错了。

A mistyped placeholder does not crash anything: `{count}` renders literally, which
makes the mistake obvious.

## 语气 · Tone

这个界面是按**刊物**写的，不是按控制面板写的：

The interface is written as a publication, not a control panel:

- 空态标题是完整的句子，带句末标点；说明句告诉读者下一步能做什么。
  Empty-state titles are complete sentences with terminal punctuation; the
  description says what to do next.
- 不用感叹号，不用「哎呀」「糟糕」这类拟人化的惊呼。
  No exclamation marks, no "Oops!".
- 数字、时长、刊号一律用等宽字形，翻译时不必操心，样式已经处理。
  Numbers, durations, and issue numbers are set in tabular figures; styling is
  already handled.

## Weblate

两份 JSON 是扁平 key-value，可以直接作为 Weblate 的
**JSON file (flat)** 组件接入：

The flat key-value shape works directly as a Weblate **JSON file (flat)** component:

| 字段 field | 值 value |
| --- | --- |
| File format | JSON file (flat) |
| Filemask | `frontend/src/i18n/locales/*.json` |
| Monolingual base language file | `frontend/src/i18n/locales/zh-CN.json` |
| Source language | `zh-CN` |

新语言由 Weblate 自动加出文件后，仍需按上面第 2 步在 `index.ts` 里登记一次——
这是唯一需要碰代码的地方。

When Weblate adds a new file, it still needs registering in `index.ts` per step 2
above. That is the only place code has to change.
