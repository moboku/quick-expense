# Quick Expense

**Log an expense in seconds.** Type what you bought and how much, tap a category, done. Your location carries over from the last expense, and every expense is a plain Markdown note with properties, so you can total it with Bases or Dataview.

[中文说明](#中文说明)

```
┌──────────── Log an expense ─────────────┐
│ 📍 Tokyo ▾                 2026-11-13 ▾ │
│ [ Ramen                              ]  │
│ [ 1200                               ]  │
│ [🍜 Food] [☕ Coffee] [🚃 Transport] …   │  ← tap = saved
└─────────────────────────────────────────┘
```

## How it works

1. Run **Log an expense** from the ribbon wallet icon, the command palette or a hotkey.
2. Type what you bought, press Enter, type the amount, press Enter.
3. Tap a category. The note is created and the dialog closes.

The new note looks like this:

```yaml
---
date: 2026-11-13
category: Food
amount: 1200
location:
  - Tokyo
---
```

### Location carries over

The location you used last is filled in automatically, which helps on trips where you log many expenses in one city. Tap 📍 to pick a recent location or type a new one. With **Use as current location** on, it becomes the new default. Turn it off to use a location for one expense only.

When you change the current location and other expenses that day have a different location or none, you are asked whether to update all of them, only the ones without a location, or none.

### Categories

Categories are sorted by how often you use them. In settings, write one per line, either `value` or `value | button label`. The value is what gets saved, so you can keep long names like `Food & Dining` and show a short label like `🍜 Food`.

## Settings

| Setting | Default |
| --- | --- |
| Folder | `Expenses` |
| Current location | Last one you used |
| Categories | 12 common categories |
| Sort categories by use | On |
| Offer to update the day's other expenses | On |
| Property names | `date`, `category`, `amount`, `location`. Change them to match notes you already have. |
| Save location as a list | On |

## Sum it with Bases

Create a `.base` file like this to get daily and monthly totals:

```yaml
filters:
  and:
    - file.inFolder("Expenses")
formulas:
  month: date.format("YYYY-MM")
views:
  - type: table
    name: By day
    groupBy:
      property: date
      direction: DESC
    order: [file.name, category, amount, location]
    summaries:
      amount: Sum
  - type: table
    name: By month
    groupBy:
      property: formula.month
      direction: DESC
    order: [file.name, date, category, amount]
    summaries:
      amount: Sum
```

## Install

Until it's in the community plugin list, copy `main.js`, `manifest.json` and `styles.css` from the latest [release](../../releases) into `<vault>/.obsidian/plugins/quick-expense/`, then enable **Quick Expense** in **Settings → Community plugins**.

## Development

```bash
npm install
npm run dev    # watch build
npm run build  # type check + production build
npm run lint
```

## License

MIT

---

## 中文说明

**几秒记一笔账。** 写买了什么、填金额、点一下类别就存好。地点沿用上一笔，每一笔都是带属性的普通笔记，可以直接用 Bases 或 Dataview 求和。

- 从左边栏的钱包图标、命令面板或快捷键打开「记一笔」。
- 写内容，回车；填金额，回车；点类别，存好、关窗。
- **地点跟随**：自动带上上次的地点，旅行时在同一个城市连着记很省事。点 📍 可以选最近去过的地点或输入新的。不勾「设为当前地点」就只用于这一笔。
- **改当天其他记录**：换了当前地点时，如果当天还有别的地点或没填地点的记录，会问你全部改、只改没填的，还是不改。
- **类别**：按使用次数排序。设置里每行写一个 `值` 或 `值 | 按钮文字`，保存的是值。
- **属性名可改**：和你已有的笔记保持一致，比如 `Date / Category / Amount / 地点`。
